import os
import shutil
import tempfile
import logging
import requests
import re
from datetime import datetime
from flask import Flask, request, jsonify
from flask_cors import CORS
from git import Repo

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = Flask(__name__)
CORS(app, resources={r"/api/*": {"origins": "*"}})

IGNORE_LIST = {
    '.git', '.github', 'node_modules', 'venv', '__pycache__', '.next',
    'dist', 'build', '.angular', '.vscode', 'package-lock.json', 'yarn.lock',
    '.env', '.env.local', '.env.production', 'coverage', '.nyc_output',
    '.cache', 'tmp', 'temp', '.DS_Store', 'Thumbs.db'
}
IGNORE_EXTENSIONS = {
    '.png', '.jpg', '.jpeg', '.gif', '.svg', '.ico', '.pdf', '.zip',
    '.tar', '.gz', '.mp4', '.mp3', '.woff', '.woff2', '.ttf', '.eot',
    '.otf', '.webp', '.avif', '.bmp', '.tiff', '.psd', '.ai', '.sketch',
    '.fig', '.dmg', '.exe', '.bin', '.dll', '.so', '.dylib', '.class',
    '.pyc', '.pyo', '.o', '.a', '.lib'
}

def parse_github_url(url):
    url = url.rstrip('/')
    pattern = r"github\.com/([^/]+)/([^/.?#]+)"
    match = re.search(pattern, url)
    if match:
        return match.group(1), match.group(2)
    return None, None

def get_auth_headers(token=None):
    headers = {
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'CopyGit/1.0'
    }
    if token and token.strip():
        headers['Authorization'] = f'token {token.strip()}'
    return headers

@app.route('/api/repo-info', methods=['POST'])
def get_repo_info():
    data = request.json or {}
    repo_url = data.get('url', '').strip()
    token = data.get('token', '').strip()
    owner, repo = parse_github_url(repo_url)

    if not owner or not repo:
        return jsonify({"error": "Invalid GitHub URL", "code": "INVALID_URL"}), 400

    try:
        headers = get_auth_headers(token)
        repo_api_url = f"https://api.github.com/repos/{owner}/{repo}"
        repo_resp = requests.get(repo_api_url, headers=headers, timeout=10)

        if repo_resp.status_code == 401:
            return jsonify({"error": "Invalid token. Please check your GitHub token.", "code": "INVALID_TOKEN"}), 401
        elif repo_resp.status_code == 403:
            rate_limit = repo_resp.headers.get('X-RateLimit-Remaining', '?')
            if rate_limit == '0':
                return jsonify({"error": "GitHub API rate limit exceeded. Add a token to increase limits.", "code": "RATE_LIMITED"}), 429
            return jsonify({"error": "Access forbidden. Your token may lack 'repo' scope.", "code": "FORBIDDEN"}), 403
        elif repo_resp.status_code == 404:
            return jsonify({"error": "Repository not found or is private.", "code": "PRIVATE_OR_NOT_FOUND"}), 404
        elif repo_resp.status_code != 200:
            return jsonify({"error": f"GitHub API error ({repo_resp.status_code})", "code": "API_ERROR"}), 502

        repo_data = repo_resp.json()
        default_branch = repo_data.get('default_branch', 'main')

        branches_url = f"https://api.github.com/repos/{owner}/{repo}/branches?per_page=100"
        branches_resp = requests.get(branches_url, headers=headers, timeout=10)
        branches_data = branches_resp.json() if branches_resp.status_code == 200 else []
        branch_names = [b['name'] for b in branches_data] if isinstance(branches_data, list) else []

        if default_branch not in branch_names:
            branch_names.insert(0, default_branch)

        return jsonify({
            "default_branch": default_branch,
            "branches": sorted(list(set(branch_names))),
            "repo_name": repo_data.get('name', repo),
            "full_name": repo_data.get('full_name', f'{owner}/{repo}'),
            "owner": owner,
            "private": repo_data.get('private', False),
            "description": repo_data.get('description') or '',
            "stars": repo_data.get('stargazers_count', 0),
            "language": repo_data.get('language') or '',
            "size_kb": repo_data.get('size', 0),
        })
    except requests.exceptions.Timeout:
        return jsonify({"error": "Request timed out. GitHub may be slow.", "code": "TIMEOUT"}), 504
    except Exception as e:
        logger.error(f"Metadata fetch failed: {str(e)}")
        return jsonify({"error": "Could not fetch repository info.", "code": "UNKNOWN"}), 500


def get_directory_structure(root_path, current_dir=None):
    if current_dir is None:
        current_dir = root_path
    structure = []
    try:
        items = sorted(os.listdir(current_dir), key=lambda x: (not os.path.isdir(os.path.join(current_dir, x)), x.lower()))
    except Exception:
        return structure

    for item in items:
        if item in IGNORE_LIST:
            continue
        full_path = os.path.join(current_dir, item)
        rel_path = os.path.relpath(full_path, root_path)
        is_dir = os.path.isdir(full_path)

        if not is_dir:
            _, ext = os.path.splitext(item)
            if ext.lower() in IGNORE_EXTENSIONS:
                continue

        node = {
            "name": item,
            "path": rel_path.replace(os.sep, '/'),
            "type": "directory" if is_dir else "file",
            "children": get_directory_structure(root_path, full_path) if is_dir else None
        }
        if not is_dir:
            try:
                node["size"] = os.path.getsize(full_path)
            except Exception:
                node["size"] = 0
        structure.append(node)
    return structure


def generate_tree_visual(selected_files):
    tree = {}
    for path in selected_files:
        parts = path.split('/')
        current = tree
        for part in parts:
            if part not in current:
                current[part] = {}
            current = current[part]

    lines = []

    def walk(node, prefix=""):
        items = sorted(node.items(), key=lambda x: (bool(x[1]), x[0].lower()))
        for i, (name, children) in enumerate(items):
            is_last = (i == len(items) - 1)
            connector = "└── " if is_last else "├── "
            lines.append(f"{prefix}{connector}{name}")
            if children:
                new_prefix = prefix + ("    " if is_last else "│   ")
                walk(children, new_prefix)

    walk(tree)
    return "\n".join(lines)


@app.route('/api/analyze', methods=['POST'])
def analyze_repo():
    data = request.json or {}
    repo_url = data.get('url', '').strip()
    branch = data.get('branch', 'main').strip()
    token = data.get('token', '').strip()

    owner, repo = parse_github_url(repo_url)
    if not owner or not repo:
        return jsonify({"error": "Invalid GitHub URL", "code": "INVALID_URL"}), 400

    temp_dir = tempfile.mkdtemp()
    try:
        if token:
            clone_url = f"https://oauth2:{token}@github.com/{owner}/{repo}.git"
        else:
            clone_url = f"https://github.com/{owner}/{repo}.git"

        Repo.clone_from(clone_url, temp_dir, depth=1, branch=branch, env={"GIT_TERMINAL_PROMPT": "0"})
        structure = get_directory_structure(temp_dir)

        return jsonify({
            "structure": structure,
            "repo_path": temp_dir,
            "repo_name": repo,
            "owner": owner,
            "branch": branch
        })
    except Exception as e:
        logger.error(f"Clone failed: {str(e)}")
        if os.path.exists(temp_dir):
            shutil.rmtree(temp_dir, ignore_errors=True)
        error_str = str(e).lower()
        if 'authentication' in error_str or 'could not read' in error_str or 'terminal prompt' in error_str:
            return jsonify({
                "error": "Authentication failed. This repository may be private.",
                "code": "AUTH_FAILED"
            }), 401
        if 'not found' in error_str or 'repository' in error_str:
            return jsonify({
                "error": "Repository or branch not found.",
                "code": "NOT_FOUND"
            }), 404
        return jsonify({"error": str(e), "code": "CLONE_FAILED"}), 500


@app.route('/api/process', methods=['POST'])
def process_files():
    data = request.json or {}
    repo_path = data.get('repo_path', '')
    selected_files = data.get('files', [])
    repo_name = data.get('repo_name', 'repository')
    branch = data.get('branch', 'main')
    owner = data.get('owner', '')

    if not repo_path or not os.path.exists(repo_path):
        return jsonify({"error": "Session expired. Please re-analyze the repository.", "code": "SESSION_EXPIRED"}), 400

    try:
        now = datetime.utcnow().strftime('%Y-%m-%d %H:%M UTC')
        full_name = f"{owner}/{repo_name}" if owner else repo_name
        file_count = len(selected_files)
        SEP = "=" * 80
        THIN = "-" * 80

        header = f"""{SEP}
COPYGIT BUNDLE
{SEP}
Repository : {full_name}
Branch     : {branch}
Files      : {file_count} files selected
Generated  : {now}
Tool       : CopyGit — https://copygit.vercel.app
{SEP}

This bundle contains the selected source files from the repository above.
It is formatted for use as AI context (LLM prompt input).

"""

        tree_text = generate_tree_visual(selected_files)
        tree_section = f"""DIRECTORY STRUCTURE
{THIN}
{tree_text}

{SEP}

"""

        file_sections = []
        skipped = []
        for rel_path in sorted(selected_files):
            full_path = os.path.join(repo_path, rel_path.replace('/', os.sep))
            if os.path.isfile(full_path):
                try:
                    with open(full_path, 'r', encoding='utf-8', errors='strict') as f:
                        content = f.read()
                except UnicodeDecodeError:
                    try:
                        with open(full_path, 'r', encoding='latin-1') as f:
                            content = f.read()
                    except Exception:
                        skipped.append(rel_path)
                        continue

                file_header = f"FILE: {rel_path}\n{THIN}"
                file_sections.append(f"{file_header}\n{content}\n\n{SEP}\n")

        files_section = "FILES\n" + SEP + "\n\n" + "\n".join(file_sections)

        if skipped:
            skip_note = f"\n\nNOTE: {len(skipped)} file(s) were skipped due to encoding issues:\n" + "\n".join(f"  - {f}" for f in skipped) + "\n"
            files_section += skip_note

        full_text = header + tree_section + files_section

        return jsonify({
            "full_text": full_text,
            "file_count": file_count,
            "skipped": skipped
        })
    except Exception as e:
        logger.error(f"Process failed: {str(e)}")
        return jsonify({"error": str(e), "code": "PROCESS_FAILED"}), 500


@app.route('/ping', methods=['GET'])
def ping():
    return "pong", 200


if __name__ == '__main__':
    app.run(debug=True, port=5000)
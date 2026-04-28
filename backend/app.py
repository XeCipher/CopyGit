import os
import shutil
import tempfile
import logging
import requests
import re
from flask import Flask, request, jsonify, make_response
from flask_cors import CORS
from git import Repo

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = Flask(__name__)
CORS(app, resources={r"/api/*": {"origins": "*"}})

IGNORE_LIST = {'.git', '.github', 'node_modules', 'venv', '__pycache__', '.next', 'dist', 'build', '.angular', '.vscode', 'package-lock.json', 'yarn.lock'}
IGNORE_EXTENSIONS = {'.png', '.jpg', '.jpeg', '.gif', '.svg', '.ico', '.pdf', '.zip', '.tar', '.gz', '.mp4', '.mp3', '.woff', '.woff2', '.ttf', '.eot'}

def parse_github_url(url):
    """Extracts owner and repo name from a GitHub URL."""
    # Clean trailing slashes
    url = url.rstrip('/')
    pattern = r"github\.com/([^/]+)/([^/.]+)"
    match = re.search(pattern, url)
    if match:
        return match.group(1), match.group(2)
    return None, None

@app.route('/api/repo-info', methods=['POST'])
def get_repo_info():
    data = request.json
    repo_url = data.get('url')
    owner, repo = parse_github_url(repo_url)
    
    if not owner or not repo:
        return jsonify({"error": "Invalid GitHub URL"}), 400

    try:
        # 1. Get repository metadata (for default branch)
        repo_api_url = f"https://api.github.com/repos/{owner}/{repo}"
        repo_resp = requests.get(repo_api_url)
        
        if repo_resp.status_code != 200:
            return jsonify({"error": "Repository not found or private"}), 404
            
        repo_data = repo_resp.json()
        default_branch = repo_data.get('default_branch', 'main')

        # 2. Get branches (increased per_page to 100 to avoid missing branches)
        # Note: If a repo has >100 branches, we'd need to loop through pages.
        branches_api_url = f"https://api.github.com/repos/{owner}/{repo}/branches?per_page=100"
        branches_resp = requests.get(branches_api_url)
        branches_data = branches_resp.json()
        
        branch_names = [b['name'] for b in branches_data]

        # 3. Safety check: ensure default branch is in the list
        if default_branch not in branch_names:
            branch_names.insert(0, default_branch)

        return jsonify({
            "default_branch": default_branch,
            "branches": sorted(list(set(branch_names))) # Unique and sorted
        })
    except Exception as e:
        logger.error(f"Metadata fetch failed: {str(e)}")
        return jsonify({"error": "Could not fetch repo info"}), 500

def get_directory_structure(root_path, current_dir=None):
    if current_dir is None: current_dir = root_path
    structure = []
    try:
        items = sorted(os.listdir(current_dir))
    except Exception: return structure
    for item in items:
        if item in IGNORE_LIST: continue
        full_path = os.path.join(current_dir, item)
        rel_path = os.path.relpath(full_path, root_path)
        is_dir = os.path.isdir(full_path)
        if not is_dir:
            _, ext = os.path.splitext(item)
            if ext.lower() in IGNORE_EXTENSIONS: continue
        structure.append({
            "name": item,
            "path": rel_path.replace(os.sep, '/'),
            "type": "directory" if is_dir else "file",
            "children": get_directory_structure(root_path, full_path) if is_dir else None
        })
    return structure

def generate_tree_visual(selected_files):
    tree = {}
    for path in selected_files:
        parts = path.split('/')
        current = tree
        for part in parts:
            if part not in current: current[part] = {}
            current = current[part]
    lines = ["DIRECTORY STRUCTURE:", ""]
    def walk(node, prefix=""):
        items = sorted(node.items())
        for i, (name, children) in enumerate(items):
            is_last = (i == len(items) - 1)
            connector = "└── " if is_last else "├── "
            lines.append(f"{prefix}{connector}{name}")
            if children:
                new_prefix = prefix + ("    " if is_last else "│   ")
                walk(children, new_prefix)
    walk(tree)
    lines.append("\n" + "="*50 + "\n")
    return "\n".join(lines)

@app.route('/api/analyze', methods=['POST'])
def analyze_repo():
    data = request.json
    repo_url = data.get('url')
    branch = data.get('branch', 'main')
    temp_dir = tempfile.mkdtemp()
    try:
        # Shallow clone specific branch
        Repo.clone_from(repo_url, temp_dir, depth=1, branch=branch)
        structure = get_directory_structure(temp_dir)
        return jsonify({"structure": structure, "repo_path": temp_dir})
    except Exception as e:
        logger.error(f"Clone failed: {str(e)}")
        if os.path.exists(temp_dir): shutil.rmtree(temp_dir)
        return jsonify({"error": str(e)}), 500

@app.route('/api/process', methods=['POST'])
def process_files():
    data = request.json
    repo_path = data.get('repo_path')
    selected_files = data.get('files', [])
    if not repo_path or not os.path.exists(repo_path):
        return jsonify({"error": "Session expired"}), 400
    try:
        output = [generate_tree_visual(selected_files)]
        for rel_path in sorted(selected_files):
            full_path = os.path.join(repo_path, rel_path.replace('/', os.sep))
            if os.path.isfile(full_path):
                output.append(f"FILE: {rel_path}\n" + "-"*len(f"FILE: {rel_path}"))
                with open(full_path, 'r', encoding='utf-8', errors='ignore') as f:
                    output.append(f.read())
                output.append("\n" + "="*50 + "\n")
        return jsonify({"full_text": "\n".join(output)})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/ping', methods=['GET'])
def ping():
    return "pong", 200

if __name__ == '__main__':
    app.run(debug=True, port=5000)
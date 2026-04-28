import os
import shutil
import tempfile
import logging
from flask import Flask, request, jsonify, make_response
from flask_cors import CORS
from git import Repo

# Setup logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = Flask(__name__)

# Allows local Angular dev and eventually the production Vercel URL
CORS(app, resources={r"/api/*": {"origins": "*"}})

# Standard boilerplate to ignore
IGNORE_LIST = {
    '.git', '.github', 'node_modules', 'venv', '__pycache__', 
    '.next', 'dist', 'build', '.angular', '.vscode',
    'package-lock.json', 'yarn.lock', '.DS_Store'
}

# Binary files that shouldn't be read as text
IGNORE_EXTENSIONS = {
    '.png', '.jpg', '.jpeg', '.gif', '.svg', '.ico', 
    '.pdf', '.zip', '.tar', '.gz', '.mp4', '.mp3',
    '.woff', '.woff2', '.ttf', '.eot', '.exe', '.bin'
}

def get_directory_structure(root_path, current_dir=None):
    """ Builds a nested list representing the folder structure. """
    if current_dir is None:
        current_dir = root_path
    structure = []
    try:
        items = sorted(os.listdir(current_dir))
    except Exception:
        return structure

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
    """ Creates the ASCII tree for the top of the output file. """
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

@app.route('/api/analyze', methods=['POST', 'OPTIONS'])
def analyze_repo():
    if request.method == 'OPTIONS': return _build_cors_preflight_response()
    
    data = request.json
    repo_url = data.get('url')
    branch = data.get('branch', 'main')
    
    logger.info(f"Analyzing: {repo_url} on branch {branch}")
    temp_dir = tempfile.mkdtemp()
    
    try:
        Repo.clone_from(repo_url, temp_dir, depth=1, branch=branch)
        structure = get_directory_structure(temp_dir)
        return jsonify({"structure": structure, "repo_path": temp_dir})
    except Exception as e:
        logger.error(f"Cloning error: {str(e)}")
        if os.path.exists(temp_dir): shutil.rmtree(temp_dir)
        return jsonify({"error": str(e)}), 500

@app.route('/api/process', methods=['POST', 'OPTIONS'])
def process_files():
    if request.method == 'OPTIONS': return _build_cors_preflight_response()
    
    data = request.json
    repo_path = data.get('repo_path')
    selected_files = data.get('files', [])
    
    if not repo_path or not os.path.exists(repo_path):
        return jsonify({"error": "Repository data expired"}), 400

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

def _build_cors_preflight_response():
    response = make_response()
    response.headers.add("Access-Control-Allow-Origin", "*")
    response.headers.add('Access-Control-Allow-Headers', "*")
    response.headers.add('Access-Control-Allow-Methods', "*")
    return response

if __name__ == '__main__':
    app.run(debug=True, port=5000)
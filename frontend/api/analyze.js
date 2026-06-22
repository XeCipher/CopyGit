const IGNORE_LIST = new Set([
  '.git', '.github', 'node_modules', 'venv', '__pycache__', '.next',
  'dist', 'build', '.angular', '.vscode', 'package-lock.json', 'yarn.lock',
  '.env', '.env.local', '.env.production', 'coverage', '.nyc_output',
  '.cache', 'tmp', 'temp', '.DS_Store', 'Thumbs.db'
]);

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { url: repoUrl, branch, token } = req.body || {};
  const match = repoUrl?.match(/github\.com\/([^/]+)\/([^/.?#]+)/);
  if (!match) return res.status(400).json({ error: 'Invalid GitHub URL', code: 'INVALID_URL' });

  const[, owner, repo] = match;
  const activeToken = token?.trim() || process.env.GITHUB_BACKEND_TOKEN?.trim();

  const headers = { 'Accept': 'application/vnd.github.v3+json', 'User-Agent': 'CopyGit/1.0' };
  if (activeToken) headers['Authorization'] = `Bearer ${activeToken}`;

  try {
    // We hit the Git Trees API. No cloning required!
    const treeResp = await fetch(`https://api.github.com/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`, { headers });
    
    if (treeResp.status === 404) return res.status(401).json({ error: 'Lacks permissions', code: 'LACKS_CONTENTS_PERMISSION' });
    if (!treeResp.ok) throw new Error("Failed to fetch repository tree");

    const treeData = await treeResp.json();
    const treeMap = {};

    for (const item of treeData.tree) {
      const parts = item.path.split('/');
      
      // Filter out ignored folders like node_modules, .git, etc.
      if (parts.some(p => IGNORE_LIST.has(p))) continue;

      let currentLevel = treeMap;
      for (let i = 0; i < parts.length; i++) {
        const part = parts[i];
        const isLast = i === parts.length - 1;
        
        if (!currentLevel[part]) {
          currentLevel[part] = {
            name: part,
            path: parts.slice(0, i + 1).join('/'),
            type: (isLast && item.type === 'blob') ? 'file' : 'directory',
            size: (isLast && item.type === 'blob') ? item.size : 0,
            children: (isLast && item.type === 'blob') ? undefined : {}
          };
        }
        if (!isLast) {
          currentLevel = currentLevel[part].children;
        }
      }
    }

    // Convert map to nested array and compute directory sizes
    function convertToArrayAndComputeSize(mapObj) {
      const result = [];
      let totalSize = 0;

      for (const key of Object.keys(mapObj).sort((a, b) => {
        const nodeA = mapObj[a];
        const nodeB = mapObj[b];
        if (nodeA.type !== nodeB.type) return nodeA.type === 'directory' ? -1 : 1;
        return a.localeCompare(b);
      })) {
        const node = mapObj[key];
        if (node.type === 'directory') {
          const { childrenArray, dirSize } = convertToArrayAndComputeSize(node.children);
          node.children = childrenArray;
          node.size = dirSize;
          totalSize += dirSize;
        } else {
          totalSize += node.size;
        }
        result.push(node);
      }
      return { childrenArray: result, dirSize: totalSize };
    }

    const { childrenArray } = convertToArrayAndComputeSize(treeMap);

    return res.status(200).json({
      structure: childrenArray,
      repo_path: "stateless", 
      repo_name: repo,
      owner: owner,
      branch: branch
    });

  } catch (error) {
    return res.status(500).json({ error: 'Failed to analyze repository.', code: 'ANALYZE_FAILED' });
  }
}
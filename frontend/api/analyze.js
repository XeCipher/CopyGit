import {
  parseBody,
  parseGitHubUrl,
  getActiveToken,
  buildGitHubHeaders,
  setNoCacheHeaders,
  safeJson,
  isRateLimitResponse,
  formatRateLimitError,
  formatCommitInfo
} from './_github.js';

const IGNORE_LIST = new Set([
  '.git', '.github', 'node_modules', 'venv', '__pycache__', '.next',
  'dist', 'build', '.angular', '.vscode', 'package-lock.json', 'yarn.lock',
  '.env', '.env.local', '.env.production', 'coverage', '.nyc_output',
  '.cache', 'tmp', 'temp', '.DS_Store', 'Thumbs.db'
]);

const nodeCollator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

function convertToArrayAndComputeSize(mapObj) {
  const result = [];
  let totalSize = 0;

  const keys = Object.keys(mapObj).sort((a, b) => {
    const nodeA = mapObj[a];
    const nodeB = mapObj[b];
    if (nodeA.type !== nodeB.type) {
      return nodeA.type === 'directory' ? -1 : 1;
    }
    return nodeCollator.compare(a, b);
  });

  for (const key of keys) {
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

export default async function handler(req, res) {
  setNoCacheHeaders(res);
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { url: repoUrl, branch, commit_sha: rawCommitSha, token } = parseBody(req);
  const commitSha = typeof rawCommitSha === 'string' ? rawCommitSha.trim() : '';
  const parsed = parseGitHubUrl(repoUrl);
  if (!parsed || (!branch && !commitSha)) {
    return res.status(400).json({ error: 'Invalid GitHub URL or missing branch.', code: 'INVALID_URL' });
  }

  const { owner, repo } = parsed;
  const { token: activeToken, isUserToken } = getActiveToken(token);
  const headers = buildGitHubHeaders(activeToken);
  const baseRepoUrl = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;

  try {
    // Resolve either the pinned commit or the fresh branch HEAD so tree + tarball stay pinned to one commit
    const commitUrl = commitSha
      ? `${baseRepoUrl}/commits/${encodeURIComponent(commitSha)}`
      : `${baseRepoUrl}/commits?sha=${encodeURIComponent(branch)}&per_page=1`;

    const commitResp = await fetch(commitUrl, { headers });

    if (commitResp.status === 401) {
      return res.status(401).json({ error: 'Invalid or expired GitHub token.', code: 'INVALID_TOKEN' });
    }

    if (commitResp.status === 409) {
      return res.status(200).json({
        structure: [],
        repo_path: 'stateless',
        repo_name: repo,
        owner,
        branch: branch || '',
        commit_sha: '',
        pinned_commit: Boolean(commitSha),
        latest_commit: formatCommitInfo(null),
        truncated: false,
        total_files: 0,
        empty: true
      });
    }

    if (!commitResp.ok) {
      const errBody = await safeJson(commitResp);
      if (isRateLimitResponse(commitResp, errBody)) {
        return res.status(429).json({
          error: formatRateLimitError(commitResp),
          code: 'RATE_LIMITED'
        });
      }
      if (commitResp.status === 403 || (commitResp.status === 404 && isUserToken && !commitSha)) {
        return res.status(403).json({
          error: 'Token lacks Contents read permission for this repository.',
          code: 'LACKS_CONTENTS_PERMISSION'
        });
      }
      if (commitResp.status === 404 || commitResp.status === 422) {
        return res.status(404).json({
          error: commitSha ? 'Commit or repository not found.' : 'Branch or repository not found.',
          code: 'NOT_FOUND'
        });
      }
      return res.status(502).json({ error: errBody?.message || 'Failed to resolve commit.', code: 'API_ERROR' });
    }

    const commitPayload = await commitResp.json();
    const head = commitSha
      ? commitPayload
      : (Array.isArray(commitPayload) ? commitPayload[0] : null);

    if (!head) {
      return res.status(200).json({
        structure: [],
        repo_path: 'stateless',
        repo_name: repo,
        owner,
        branch: branch || '',
        commit_sha: '',
        pinned_commit: Boolean(commitSha),
        latest_commit: null,
        truncated: false,
        total_files: 0,
        empty: true
      });
    }

    // Only capture ETag for branch HEAD requests so conditional polling matches the exact endpoint
    const headEtag = commitSha ? '' : (commitResp.headers.get('etag') || '');
    const resolvedCommit = formatCommitInfo(head, headEtag);

    const treeRef = resolvedCommit.tree_sha || head.sha;
    const treeResp = await fetch(
      `${baseRepoUrl}/git/trees/${encodeURIComponent(treeRef)}?recursive=1`,
      { headers }
    );

    if (treeResp.status === 401) {
      return res.status(401).json({ error: 'Invalid or expired GitHub token.', code: 'INVALID_TOKEN' });
    }

    if (!treeResp.ok) {
      const errBody = await safeJson(treeResp);
      if (isRateLimitResponse(treeResp, errBody)) {
        return res.status(429).json({
          error: formatRateLimitError(treeResp),
          code: 'RATE_LIMITED'
        });
      }
      if (treeResp.status === 403 || treeResp.status === 404) {
        return res.status(403).json({
          error: 'Token lacks Contents read permission for this repository.',
          code: 'LACKS_CONTENTS_PERMISSION'
        });
      }
      throw new Error(errBody?.message || 'Failed to fetch repository tree.');
    }

    const treeData = await treeResp.json();
    const treeMap = Object.create(null);
    let totalFiles = 0;

    for (const item of treeData.tree || []) {
      // Only create tree nodes from actual file blobs so submodules and empty ignored dirs are omitted
      if (item.type !== 'blob') continue;

      const parts = item.path.split('/');
      if (parts.some(p => IGNORE_LIST.has(p))) continue;

      let currentLevel = treeMap;
      for (let i = 0; i < parts.length; i++) {
        const part = parts[i];
        const isLast = i === parts.length - 1;

        if (!currentLevel[part]) {
          currentLevel[part] = isLast
            ? {
                name: part,
                path: item.path,
                type: 'file',
                size: item.size || 0
              }
            : {
                name: part,
                path: parts.slice(0, i + 1).join('/'),
                type: 'directory',
                size: 0,
                children: Object.create(null)
              };
        }

        if (!isLast) {
          currentLevel = currentLevel[part].children;
        }
      }

      totalFiles++;
    }

    const { childrenArray } = convertToArrayAndComputeSize(treeMap);

    return res.status(200).json({
      structure: childrenArray,
      repo_path: 'stateless',
      repo_name: repo,
      owner,
      branch: branch || '',
      commit_sha: resolvedCommit.sha,
      pinned_commit: Boolean(commitSha),
      latest_commit: resolvedCommit,
      truncated: Boolean(treeData.truncated),
      total_files: totalFiles,
      empty: false
    });
  } catch (error) {
    return res.status(500).json({
      error: error?.message || 'Failed to analyze repository.',
      code: 'ANALYZE_FAILED'
    });
  }
}
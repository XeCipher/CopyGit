import {
  parseBody,
  parseGitHubUrl,
  getActiveToken,
  buildGitHubHeaders,
  setNoCacheHeaders,
  safeJson,
  isRateLimitResponse,
  formatRateLimitError
} from './_github.js';

export default async function handler(req, res) {
  setNoCacheHeaders(res);
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { url: repoUrl, branch, token } = parseBody(req);
  if (!repoUrl || !branch) {
    return res.status(400).json({ error: 'Missing repository URL or branch.', code: 'INVALID_REQ' });
  }

  const parsed = parseGitHubUrl(repoUrl);
  if (!parsed) {
    return res.status(400).json({ error: 'Invalid GitHub repository URL.', code: 'INVALID_URL' });
  }

  const { owner, repo } = parsed;
  const { token: activeToken } = getActiveToken(token);
  const headers = buildGitHubHeaders(activeToken);

  try {
    // Using ?sha=...&per_page=1 handles branch names with slashes and avoids large file-diff payloads
    const commitUrl = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/commits?sha=${encodeURIComponent(branch)}&per_page=1`;
    const commitResp = await fetch(commitUrl, { headers });

    if (commitResp.status === 401) {
      return res.status(401).json({ error: 'Invalid or expired GitHub token.', code: 'INVALID_TOKEN' });
    }

    if (commitResp.status === 409) {
      return res.status(200).json({
        empty: true,
        sha: '',
        tree_sha: '',
        message: 'Repository is empty (no commits yet)',
        author: '',
        date: '',
        html_url: ''
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
      if (commitResp.status === 403) {
        return res.status(403).json({
          error: errBody?.message || 'Token lacks permission to read commits.',
          code: 'LACKS_CONTENTS_PERMISSION'
        });
      }
      if (commitResp.status === 404) {
        return res.status(404).json({ error: 'Branch or commit not found.', code: 'NOT_FOUND' });
      }
      return res.status(502).json({ error: 'GitHub API error.', code: 'API_ERROR' });
    }

    const commits = await commitResp.json();
    const latest = Array.isArray(commits) ? commits[0] : null;
    if (!latest) {
      return res.status(200).json({
        empty: true,
        sha: '',
        tree_sha: '',
        message: 'Repository is empty (no commits yet)',
        author: '',
        date: '',
        html_url: ''
      });
    }

    return res.status(200).json({
      empty: false,
      sha: latest.sha,
      tree_sha: latest.commit?.tree?.sha || '',
      message: (latest.commit?.message || '').split('\n')[0],
      author: latest.commit?.author?.name || latest.author?.login || 'Unknown',
      date: latest.commit?.author?.date || '',
      html_url: latest.html_url
    });
  } catch (error) {
    return res.status(500).json({ error: error?.message || 'Failed to fetch latest commit.', code: 'UNKNOWN' });
  }
}
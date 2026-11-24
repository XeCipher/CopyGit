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

export default async function handler(req, res) {
  setNoCacheHeaders(res);
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { url: repoUrl, branch, commit_sha: rawCommitSha, etag: rawEtag, token } = parseBody(req);
  const commitSha = typeof rawCommitSha === 'string' ? rawCommitSha.trim() : '';
  const clientEtag = typeof rawEtag === 'string' ? rawEtag.trim() : '';

  if (!repoUrl || (!branch && !commitSha)) {
    return res.status(400).json({ error: 'Missing repository URL or branch.', code: 'INVALID_REQ' });
  }

  const parsed = parseGitHubUrl(repoUrl);
  if (!parsed) {
    return res.status(400).json({ error: 'Invalid GitHub repository URL.', code: 'INVALID_URL' });
  }

  const { owner, repo } = parsed;
  const { token: activeToken } = getActiveToken(token);
  const headers = buildGitHubHeaders(activeToken);
  const baseRepoUrl = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;

  try {
    // Specific commit lookup (supports short and full SHAs)
    if (commitSha) {
      const commitResp = await fetch(
        `${baseRepoUrl}/commits/${encodeURIComponent(commitSha)}`,
        { headers }
      );

      if (commitResp.status === 401) {
        return res.status(401).json({ error: 'Invalid or expired GitHub token.', code: 'INVALID_TOKEN' });
      }

      if (commitResp.status === 409) {
        return res.status(200).json(formatCommitInfo(null));
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
        if (commitResp.status === 404 || commitResp.status === 422) {
          return res.status(404).json({ error: 'Commit not found.', code: 'NOT_FOUND' });
        }
        return res.status(502).json({ error: 'GitHub API error.', code: 'API_ERROR' });
      }

      const commitData = await commitResp.json();
      return res.status(200).json({ ...formatCommitInfo(commitData), unchanged: false });
    }

    // Branch HEAD lookup with optional ETag so unchanged polls cost zero GitHub rate limit
    const reqHeaders = clientEtag ? { ...headers, 'If-None-Match': clientEtag } : headers;
    const commitUrl = `${baseRepoUrl}/commits?sha=${encodeURIComponent(branch)}&per_page=1`;
    const commitResp = await fetch(commitUrl, { headers: reqHeaders });

    if (commitResp.status === 304) {
      return res.status(200).json({ unchanged: true, etag: clientEtag });
    }

    if (commitResp.status === 401) {
      return res.status(401).json({ error: 'Invalid or expired GitHub token.', code: 'INVALID_TOKEN' });
    }

    if (commitResp.status === 409) {
      return res.status(200).json({ ...formatCommitInfo(null), unchanged: false });
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

    const newEtag = commitResp.headers.get('etag') || '';
    const commits = await commitResp.json();
    const latest = Array.isArray(commits) ? commits[0] : null;

    return res.status(200).json({
      ...formatCommitInfo(latest, newEtag),
      unchanged: false
    });
  } catch (error) {
    return res.status(500).json({ error: error?.message || 'Failed to fetch latest commit.', code: 'UNKNOWN' });
  }
}
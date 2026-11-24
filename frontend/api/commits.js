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

  const {
    url: repoUrl,
    branch,
    page = 1,
    per_page: perPage = 30,
    sha_query: rawShaQuery,
    token
  } = parseBody(req);

  const shaQuery = typeof rawShaQuery === 'string' ? rawShaQuery.trim() : '';
  if (!repoUrl || (!branch && !shaQuery)) {
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
    // Direct commit lookup when searching by short or full SHA
    if (shaQuery) {
      const lookupResp = await fetch(
        `${baseRepoUrl}/commits/${encodeURIComponent(shaQuery)}`,
        { headers }
      );

      if (lookupResp.status === 401) {
        return res.status(401).json({ error: 'Invalid or expired GitHub token.', code: 'INVALID_TOKEN' });
      }

      if (lookupResp.status === 404 || lookupResp.status === 422) {
        return res.status(200).json({ commits: [], has_more: false, page: 1, not_found: true });
      }

      if (!lookupResp.ok) {
        const errBody = await safeJson(lookupResp);
        if (isRateLimitResponse(lookupResp, errBody)) {
          return res.status(429).json({
            error: formatRateLimitError(lookupResp),
            code: 'RATE_LIMITED'
          });
        }
        if (lookupResp.status === 403) {
          return res.status(403).json({
            error: errBody?.message || 'Token lacks permission to read commits.',
            code: 'LACKS_CONTENTS_PERMISSION'
          });
        }
        return res.status(502).json({ error: 'GitHub API error.', code: 'API_ERROR' });
      }

      const commitObj = await lookupResp.json();
      return res.status(200).json({
        commits: commitObj ? [formatCommitInfo(commitObj)] : [],
        has_more: false,
        page: 1,
        not_found: !commitObj
      });
    }

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(perPage, 10) || 30));

    const commitsResp = await fetch(
      `${baseRepoUrl}/commits?sha=${encodeURIComponent(branch)}&per_page=${limit}&page=${pageNum}`,
      { headers }
    );

    if (commitsResp.status === 401) {
      return res.status(401).json({ error: 'Invalid or expired GitHub token.', code: 'INVALID_TOKEN' });
    }

    if (commitsResp.status === 409) {
      return res.status(200).json({ commits: [], has_more: false, page: pageNum, empty: true });
    }

    if (!commitsResp.ok) {
      const errBody = await safeJson(commitsResp);
      if (isRateLimitResponse(commitsResp, errBody)) {
        return res.status(429).json({
          error: formatRateLimitError(commitsResp),
          code: 'RATE_LIMITED'
        });
      }
      if (commitsResp.status === 403) {
        return res.status(403).json({
          error: errBody?.message || 'Token lacks permission to read commits.',
          code: 'LACKS_CONTENTS_PERMISSION'
        });
      }
      if (commitsResp.status === 404) {
        return res.status(404).json({ error: 'Branch or repository not found.', code: 'NOT_FOUND' });
      }
      return res.status(502).json({ error: 'GitHub API error.', code: 'API_ERROR' });
    }

    const rawCommits = await commitsResp.json();
    const list = Array.isArray(rawCommits) ? rawCommits : [];
    const linkHeader = commitsResp.headers.get('link') || '';
    const hasMore = /rel=["']next["']/i.test(linkHeader);

    return res.status(200).json({
      commits: list.map(item => formatCommitInfo(item)),
      has_more: hasMore,
      page: pageNum,
      empty: list.length === 0
    });
  } catch (error) {
    return res.status(500).json({ error: error?.message || 'Failed to fetch commits.', code: 'UNKNOWN' });
  }
}
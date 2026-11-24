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

const branchCollator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
const MAX_BRANCH_PAGES = 3;

function hasNextPage(linkHeader) {
  return typeof linkHeader === 'string' && /rel=["']next["']/i.test(linkHeader);
}

export default async function handler(req, res) {
  setNoCacheHeaders(res);
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { url: repoUrl, token } = parseBody(req);
  const parsed = parseGitHubUrl(repoUrl);
  if (!parsed) {
    return res.status(400).json({ error: 'Invalid GitHub repository URL.', code: 'INVALID_URL' });
  }

  const { owner, repo } = parsed;
  const { token: activeToken } = getActiveToken(token);
  const headers = buildGitHubHeaders(activeToken);
  const baseRepoUrl = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;

  try {
    // Fetch repository metadata and first page of branches concurrently to cut latency
    const [repoResp, branchesResp] = await Promise.all([
      fetch(baseRepoUrl, { headers }),
      fetch(`${baseRepoUrl}/branches?per_page=100&page=1`, { headers })
    ]);

    if (repoResp.status === 401) {
      return res.status(401).json({ error: 'Invalid or expired GitHub token.', code: 'INVALID_TOKEN' });
    }

    if (!repoResp.ok) {
      const errBody = await safeJson(repoResp);
      if (isRateLimitResponse(repoResp, errBody)) {
        return res.status(429).json({
          error: formatRateLimitError(repoResp),
          code: 'RATE_LIMITED'
        });
      }
      if (repoResp.status === 403) {
        return res.status(403).json({
          error: errBody?.message || 'Access to this repository is forbidden.',
          code: 'FORBIDDEN'
        });
      }
      if (repoResp.status === 404) {
        return res.status(404).json({
          error: 'Repository not found or private.',
          code: 'PRIVATE_OR_LACKS_PERMISSION'
        });
      }
      return res.status(502).json({ error: 'GitHub API error.', code: 'API_ERROR' });
    }

    const repoData = await repoResp.json();
    const defaultBranch = repoData.default_branch || 'main';

    let branches = [];
    let branchesTruncated = false;

    if (branchesResp.ok) {
      const firstPage = await branchesResp.json();
      if (Array.isArray(firstPage)) {
        branches.push(...firstPage.map(b => b.name).filter(Boolean));
      }

      let morePages = hasNextPage(branchesResp.headers.get('link'));
      let currentPage = 2;

      while (morePages && currentPage <= MAX_BRANCH_PAGES) {
        const nextResp = await fetch(
          `${baseRepoUrl}/branches?per_page=100&page=${currentPage}`,
          { headers }
        );
        if (!nextResp.ok) break;

        const nextData = await nextResp.json();
        if (Array.isArray(nextData)) {
          branches.push(...nextData.map(b => b.name).filter(Boolean));
        }

        morePages = hasNextPage(nextResp.headers.get('link'));
        currentPage++;
      }

      branchesTruncated = morePages;
    }

    // Keep default branch first, then sort remaining branches naturally
    const uniqueOtherBranches = Array.from(new Set(branches))
      .filter(b => b !== defaultBranch)
      .sort((a, b) => branchCollator.compare(a, b));

    const sortedBranches = [defaultBranch, ...uniqueOtherBranches];

    return res.status(200).json({
      default_branch: defaultBranch,
      branches: sortedBranches,
      branches_truncated: branchesTruncated,
      repo_name: repoData.name,
      full_name: repoData.full_name,
      owner: repoData.owner?.login || owner,
      private: Boolean(repoData.private),
      description: repoData.description || '',
      stars: repoData.stargazers_count || 0,
      language: repoData.language || '',
      size_kb: repoData.size || 0
    });
  } catch (error) {
    return res.status(500).json({ error: error?.message || 'Unexpected server error.', code: 'UNKNOWN' });
  }
}
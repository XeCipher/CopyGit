export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { url: repoUrl, token } = req.body || {};
  if (!repoUrl) return res.status(400).json({ error: 'Invalid URL', code: 'INVALID_URL' });

  const match = repoUrl.match(/github\.com\/([^/]+)\/([^/.?#]+)/);
  if (!match) return res.status(400).json({ error: 'Invalid URL', code: 'INVALID_URL' });

  const [, owner, repo] = match;
  
  // Use user token, or fallback to your backend token for higher rate limits
  const activeToken = token?.trim() || process.env.GITHUB_BACKEND_TOKEN?.trim();

  const headers = {
    'Accept': 'application/vnd.github.v3+json',
    'User-Agent': 'CopyGit-Serverless/1.0'
  };
  
  if (activeToken) headers['Authorization'] = `Bearer ${activeToken}`;

  try {
    const repoResp = await fetch(`https://api.github.com/repos/${owner}/${repo}`, { headers });
    
    if (repoResp.status === 401) return res.status(401).json({ error: 'Invalid token', code: 'INVALID_TOKEN' });
    if (repoResp.status === 403) return res.status(429).json({ error: 'Rate limit exceeded', code: 'RATE_LIMITED' });
    if (repoResp.status === 404) return res.status(404).json({ error: 'Repo not found or private.', code: 'PRIVATE_OR_LACKS_PERMISSION' });
    if (!repoResp.ok) return res.status(502).json({ error: 'GitHub API error', code: 'API_ERROR' });

    const repoData = await repoResp.json();
    const defaultBranch = repoData.default_branch || 'main';

    const branchesResp = await fetch(`https://api.github.com/repos/${owner}/${repo}/branches?per_page=100`, { headers });
    let branches =[];
    if (branchesResp.ok) {
      const branchesData = await branchesResp.json();
      branches = branchesData.map(b => b.name);
    }

    if (!branches.includes(defaultBranch)) branches.unshift(defaultBranch);

    return res.status(200).json({
      default_branch: defaultBranch,
      branches: Array.from(new Set(branches)).sort(),
      repo_name: repoData.name,
      full_name: repoData.full_name,
      owner: owner,
      private: repoData.private,
      description: repoData.description || '',
      stars: repoData.stargazers_count || 0,
      language: repoData.language || '',
      size_kb: repoData.size || 0,
    });
  } catch (error) {
    return res.status(500).json({ error: error.message, code: 'UNKNOWN' });
  }
}
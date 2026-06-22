export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { url: repoUrl, branch, token } = req.body || {};
  if (!repoUrl || !branch) return res.status(400).json({ error: 'Missing parameters', code: 'INVALID_REQ' });

  const match = repoUrl.match(/github\.com\/([^/]+)\/([^/.?#]+)/);
  if (!match) return res.status(400).json({ error: 'Invalid URL', code: 'INVALID_URL' });

  const [, owner, repo] = match;
  
  // Use user token, or fallback to the backend token to avoid strict rate limits
  const activeToken = token?.trim() || process.env.GITHUB_BACKEND_TOKEN?.trim();

  const headers = {
    'Accept': 'application/vnd.github.v3+json',
    'User-Agent': 'CopyGit-Serverless/1.0'
  };

  if (activeToken) headers['Authorization'] = `Bearer ${activeToken}`;

  try {
    const commitResp = await fetch(`https://api.github.com/repos/${owner}/${repo}/commits/${branch}`, { headers });
    
    if (commitResp.status === 401) return res.status(401).json({ error: 'Invalid token', code: 'INVALID_TOKEN' });
    if (commitResp.status === 403) return res.status(429).json({ error: 'Rate limit exceeded', code: 'RATE_LIMITED' });
    if (commitResp.status === 404) return res.status(404).json({ error: 'Commit not found.', code: 'NOT_FOUND' });
    if (!commitResp.ok) return res.status(502).json({ error: 'GitHub API error', code: 'API_ERROR' });

    const commitData = await commitResp.json();

    return res.status(200).json({
      sha: commitData.sha,
      // Isolate the title of the commit, ignoring extended body descriptions
      message: commitData.commit.message.split('\n')[0],
      author: commitData.commit.author.name,
      date: commitData.commit.author.date,
      html_url: commitData.html_url
    });
  } catch (error) {
    return res.status(500).json({ error: error.message, code: 'UNKNOWN' });
  }
}
export function parseBody(req) {
  if (!req || req.body == null) return {};
  if (typeof req.body === 'string') {
    try {
      return JSON.parse(req.body);
    } catch {
      return {};
    }
  }
  return req.body;
}

export function parseGitHubUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') return null;
  const cleaned = rawUrl.trim();
  const match = cleaned.match(/(?:^|\/\/|@|www\.)github\.com[:/]([^/\s]+)\/([^/\s?#]+)/i);
  if (!match) return null;

  const owner = match[1];
  const repo = match[2].replace(/\.git$/i, '');
  if (!owner || !repo) return null;

  return { owner, repo };
}

export function getActiveToken(userToken) {
  const trimmedUser = typeof userToken === 'string' ? userToken.trim() : '';
  if (trimmedUser) return { token: trimmedUser, isUserToken: true };

  const backendToken = process.env.GITHUB_BACKEND_TOKEN?.trim() || '';
  return { token: backendToken, isUserToken: false };
}

export function buildGitHubHeaders(token, accept = 'application/vnd.github+json') {
  const headers = {
    'Accept': accept,
    'User-Agent': 'CopyGit/1.0',
    'X-GitHub-Api-Version': '2022-11-28'
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  return headers;
}

export function setNoCacheHeaders(res) {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
}

export async function safeJson(resp) {
  try {
    return await resp.json();
  } catch {
    return null;
  }
}

export function isRateLimitResponse(resp, bodyData) {
  if (resp.status === 429) return true;
  if (resp.status !== 403) return false;

  if (resp.headers.get('x-ratelimit-remaining') === '0') return true;
  const msg = bodyData?.message || '';
  return /rate limit/i.test(msg);
}

export function formatRateLimitError(resp) {
  const resetHeader = resp.headers.get('x-ratelimit-reset');
  if (resetHeader) {
    const resetMs = Number(resetHeader) * 1000;
    const minsLeft = Math.max(1, Math.ceil((resetMs - Date.now()) / 60000));
    return `GitHub rate limit exceeded. Try again in ~${minsLeft} min or add a personal token.`;
  }
  return 'GitHub rate limit exceeded. Add a token for higher limits.';
}
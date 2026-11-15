import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import zlib from 'node:zlib';
import tar from 'tar-stream';
import {
  parseBody,
  getActiveToken,
  buildGitHubHeaders,
  setNoCacheHeaders,
  safeJson,
  isRateLimitResponse,
  formatRateLimitError
} from './_github.js';

const IGNORE_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.svg', '.ico', '.pdf', '.zip',
  '.tar', '.gz', '.mp4', '.mp3', '.woff', '.woff2', '.ttf', '.eot',
  '.otf', '.webp', '.avif', '.bmp', '.tiff', '.psd', '.ai', '.sketch',
  '.fig', '.dmg', '.exe', '.bin', '.dll', '.so', '.dylib', '.class',
  '.pyc', '.pyo', '.o', '.a', '.lib', '.rvt', '.wasm'
]);

const MAX_RESPONSE_BYTES = 4.3 * 1024 * 1024;
const treeCollator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

function generateTreeVisual(selectedFiles) {
  const tree = Object.create(null);

  for (const filePath of selectedFiles) {
    const parts = filePath.split('/');
    let current = tree;
    for (const part of parts) {
      if (!current[part]) {
        current[part] = Object.create(null);
      }
      current = current[part];
    }
  }

  const lines = [];
  function walk(node, prefix = '') {
    const keys = Object.keys(node).sort((a, b) => {
      const aHasChildren = Object.keys(node[a]).length > 0;
      const bHasChildren = Object.keys(node[b]).length > 0;
      if (aHasChildren !== bHasChildren) return aHasChildren ? -1 : 1;
      return treeCollator.compare(a, b);
    });

    for (let i = 0; i < keys.length; i++) {
      const name = keys[i];
      const children = node[name];
      const isLast = i === keys.length - 1;
      const connector = isLast ? '└── ' : '├── ';
      lines.push(`${prefix}${connector}${name}`);
      if (Object.keys(children).length > 0) {
        walk(children, prefix + (isLast ? '    ' : '│   '));
      }
    }
  }

  walk(tree);
  return lines.join('\n');
}

export default async function handler(req, res) {
  setNoCacheHeaders(res);
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const {
    files: selectedFiles,
    repo_name: repoName,
    branch,
    commit_sha: commitSha,
    owner,
    token
  } = parseBody(req);

  if (!Array.isArray(selectedFiles) || selectedFiles.length === 0) {
    return res.status(400).json({ error: 'No files selected.', code: 'NO_FILES' });
  }

  if (!owner || !repoName || (!branch && !commitSha)) {
    return res.status(400).json({ error: 'Missing repository parameters.', code: 'INVALID_REQ' });
  }

  const uniqueSelected = Array.from(new Set(selectedFiles));
  const { token: activeToken } = getActiveToken(token);
  const headers = buildGitHubHeaders(activeToken);
  const targetRef = (commitSha && commitSha.trim()) || branch;
  const abortController = new AbortController();

  try {
    const tarUrl = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repoName)}/tarball/${encodeURIComponent(targetRef)}`;
    const tarResp = await fetch(tarUrl, { headers, signal: abortController.signal });

    if (tarResp.status === 401) {
      return res.status(401).json({ error: 'Invalid or expired GitHub token.', code: 'INVALID_TOKEN' });
    }

    if (!tarResp.ok) {
      const errBody = await safeJson(tarResp);
      if (isRateLimitResponse(tarResp, errBody)) {
        return res.status(429).json({
          error: formatRateLimitError(tarResp),
          code: 'RATE_LIMITED'
        });
      }
      if (tarResp.status === 403) {
        return res.status(403).json({
          error: 'Token lacks permission to download this repository archive.',
          code: 'LACKS_CONTENTS_PERMISSION'
        });
      }
      if (tarResp.status === 404) {
        return res.status(404).json({
          error: 'Repository archive not found for the selected commit or branch.',
          code: 'NOT_FOUND'
        });
      }
      return res.status(502).json({
        error: errBody?.message || 'Failed to fetch repository archive from GitHub.',
        code: 'PROCESS_FAILED'
      });
    }

    if (!tarResp.body) {
      throw new Error('Empty archive stream received from GitHub.');
    }

    const extract = tar.extract();
    const selectedSet = new Set(uniqueSelected);
    const seenSet = new Set();
    const extractedFiles = Object.create(null);
    const skipped = [];
    let remaining = selectedSet.size;
    let abortedEarly = false;

    const markDone = () => {
      remaining--;
      if (remaining === 0) {
        abortedEarly = true;
        abortController.abort();
      }
    };

    extract.on('entry', (header, stream, next) => {
      const slashIndex = header.name.indexOf('/');
      const relPath = slashIndex !== -1 ? header.name.slice(slashIndex + 1) : header.name;

      if (header.type === 'file' && selectedSet.has(relPath) && !seenSet.has(relPath)) {
        seenSet.add(relPath);

        const dotIndex = relPath.lastIndexOf('.');
        const ext = dotIndex !== -1 ? relPath.slice(dotIndex).toLowerCase() : '';

        if (IGNORE_EXTENSIONS.has(ext)) {
          skipped.push(relPath);
          stream.on('end', () => {
            next();
            markDone();
          });
          stream.resume();
          return;
        }

        const chunks = [];
        let isBinary = false;

        stream.on('data', chunk => {
          if (isBinary) return;
          if (chunk.includes(0x00)) {
            isBinary = true;
            chunks.length = 0;
            return;
          }
          chunks.push(chunk);
        });

        stream.on('end', () => {
          if (isBinary) {
            skipped.push(relPath);
          } else {
            extractedFiles[relPath] = Buffer.concat(chunks).toString('utf8');
          }
          next();
          markDone();
        });

        stream.on('error', err => next(err));
      } else {
        stream.on('end', () => next());
        stream.resume();
      }
    });

    const nodeStream = Readable.fromWeb(tarResp.body);
    try {
      await pipeline(nodeStream, zlib.createGunzip(), extract, { signal: abortController.signal });
    } catch (err) {
      if (!abortedEarly) {
        throw err;
      }
    }

    const sortedPaths = Object.keys(extractedFiles).sort((a, b) => treeCollator.compare(a, b));
    const includedCount = sortedPaths.length;

    const now = new Date().toISOString().replace('T', ' ').substring(0, 16) + ' UTC';
    const fullName = `${owner}/${repoName}`;
    const SEP = '='.repeat(80);
    const THIN = '-'.repeat(80);

    const filesSummary = skipped.length > 0
      ? `${includedCount} files included (${uniqueSelected.length} selected, ${skipped.length} skipped)`
      : `${uniqueSelected.length} files selected`;

    const parts = [
      `${SEP}\nCOPYGIT BUNDLE\n${SEP}\n`,
      `Repository : ${fullName}\n`,
      `Branch     : ${branch || targetRef}\n`,
      commitSha ? `Commit     : ${commitSha.slice(0, 7)}\n` : '',
      `Files      : ${filesSummary}\n`,
      `Generated  : ${now}\n`,
      `Tool       : CopyGit — https://copygit.vercel.app\n${SEP}\n\n`,
      `This bundle contains the selected source files from the repository above.\n`,
      `It is formatted for use as AI context (LLM prompt input).\n\n`,
      `DIRECTORY STRUCTURE\n${THIN}\n${generateTreeVisual(uniqueSelected)}\n\n${SEP}\n\n`,
      `FILES\n${SEP}\n\n`
    ];

    for (const relPath of sortedPaths) {
      parts.push(`FILE: ${relPath}\n${THIN}\n${extractedFiles[relPath]}\n\n${SEP}\n\n`);
    }

    if (skipped.length > 0) {
      const sortedSkipped = skipped.sort((a, b) => treeCollator.compare(a, b));
      const previewList = sortedSkipped.slice(0, 10).join(', ');
      const extraCount = sortedSkipped.length > 10 ? ` (+${sortedSkipped.length - 10} more)` : '';
      parts.push(`NOTE: ${skipped.length} files were skipped (binary or encoding issues): ${previewList}${extraCount}`);
    }

    const fullText = parts.join('');
    const byteSize = Buffer.byteLength(fullText, 'utf8');

    if (byteSize > MAX_RESPONSE_BYTES) {
      const mb = (byteSize / (1024 * 1024)).toFixed(1);
      return res.status(413).json({
        error: `Generated bundle (${mb} MB) exceeds the 4.3 MB serverless response limit. Deselect large files or generate in smaller batches.`,
        code: 'BUNDLE_TOO_LARGE'
      });
    }

    return res.status(200).json({
      full_text: fullText,
      file_count: includedCount,
      selected_count: uniqueSelected.length,
      skipped
    });
  } catch (error) {
    return res.status(500).json({
      error: error?.message || 'Failed to generate bundle.',
      code: 'PROCESS_FAILED'
    });
  }
}
import { Readable } from 'stream';
import tar from 'tar-stream';
import zlib from 'zlib';

function generateTreeVisual(selectedFiles) {
  const tree = {};
  for (const path of selectedFiles) {
    const parts = path.split('/');
    let current = tree;
    for (const part of parts) {
      if (!current[part]) current[part] = {};
      current = current[part];
    }
  }

  const lines =[];
  function walk(node, prefix = "") {
    const keys = Object.keys(node).sort((a, b) => {
      const aHasChildren = Object.keys(node[a]).length > 0;
      const bHasChildren = Object.keys(node[b]).length > 0;
      if (aHasChildren !== bHasChildren) return aHasChildren ? -1 : 1;
      return a.localeCompare(b);
    });

    for (let i = 0; i < keys.length; i++) {
      const name = keys[i];
      const children = node[name];
      const isLast = i === keys.length - 1;
      const connector = isLast ? "└── " : "├── ";
      lines.push(`${prefix}${connector}${name}`);
      if (Object.keys(children).length > 0) {
        walk(children, prefix + (isLast ? "    " : "│   "));
      }
    }
  }
  walk(tree);
  return lines.join("\n");
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { files: selectedFiles, repo_name: repoName, branch, owner, token } = req.body || {};
  if (!selectedFiles || selectedFiles.length === 0) return res.status(400).json({ error: "No files selected" });

  const activeToken = token?.trim() || process.env.GITHUB_BACKEND_TOKEN?.trim();
  const headers = { 'User-Agent': 'CopyGit/1.0' };
  if (activeToken) headers['Authorization'] = `Bearer ${activeToken}`;

  try {
    // Download tarball as a stream. GitHub redirects this automatically.
    const tarResp = await fetch(`https://api.github.com/repos/${owner}/${repoName}/tarball/${branch}`, { headers });
    if (!tarResp.ok) throw new Error("Failed to fetch repository archive from GitHub.");

    const extract = tar.extract();
    const selectedSet = new Set(selectedFiles);
    const extractedFiles = {};
    const skipped =[];

    await new Promise((resolve, reject) => {
      extract.on('entry', (header, stream, next) => {
        // Tarballs from github have a root folder (owner-repo-hash). Strip it.
        const parts = header.name.split('/');
        parts.shift(); 
        const relPath = parts.join('/');

        if (header.type === 'file' && selectedSet.has(relPath)) {
          const chunks =[];
          stream.on('data', chunk => chunks.push(chunk));
          stream.on('end', () => {
            const buf = Buffer.concat(chunks);
            // Ignore binary/corrupted extraction safely
            if (buf.includes(0x00)) {
              skipped.push(relPath);
            } else {
              extractedFiles[relPath] = buf.toString('utf8');
            }
            next();
          });
          stream.on('error', reject);
        } else {
          stream.on('end', () => next());
          stream.resume(); // drain the stream to keep it moving fast
        }
      });

      extract.on('finish', resolve);
      extract.on('error', reject);
      
      // Node 18+ Web Stream to Node Stream conversion
      Readable.fromWeb(tarResp.body).pipe(zlib.createGunzip()).pipe(extract);
    });

    const now = new Date().toISOString().replace('T', ' ').substring(0, 16) + ' UTC';
    const full_name = owner ? `${owner}/${repoName}` : repoName;
    const SEP = "=".repeat(80);
    const THIN = "-".repeat(80);

    let fullText = `${SEP}\nCOPYGIT BUNDLE\n${SEP}\n` +
                   `Repository : ${full_name}\nBranch     : ${branch}\nFiles      : ${selectedFiles.length} files selected\n` +
                   `Generated  : ${now}\nTool       : CopyGit — https://copygit.vercel.app\n${SEP}\n\n` +
                   `This bundle contains the selected source files from the repository above.\n` +
                   `It is formatted for use as AI context (LLM prompt input).\n\n` +
                   `DIRECTORY STRUCTURE\n${THIN}\n${generateTreeVisual(selectedFiles)}\n\n${SEP}\n\n` +
                   `FILES\n${SEP}\n\n`;

    for (const relPath of sortedKeys(extractedFiles)) {
      fullText += `FILE: ${relPath}\n${THIN}\n${extractedFiles[relPath]}\n\n${SEP}\n\n`;
    }

    if (skipped.length > 0) fullText += `\nNOTE: ${skipped.length} files were skipped (binary or encoding issues).`;

    return res.status(200).json({ full_text: fullText, file_count: selectedFiles.length, skipped });

  } catch (error) {
    return res.status(500).json({ error: error.message, code: 'PROCESS_FAILED' });
  }
}

function sortedKeys(obj) {
  return Object.keys(obj).sort((a, b) => a.localeCompare(b));
}
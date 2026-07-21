// Minimal .env.local loader (KEY=value lines; no dependency). The file is
// gitignored: it holds the Neon connection string and never enters git.
const fs = require('fs');
const path = require('path');

try {
  const lines = fs.readFileSync(path.join(__dirname, '.env.local'), 'utf8').split('\n');
  for (const line of lines) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
} catch {}

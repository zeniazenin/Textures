#!/usr/bin/env node
// Upload generated/ to R2 through the Cloudflare REST API using the OAuth session that
// `npx wrangler login` stored. No R2 API token needed. Incremental by MD5 (ETag). Never deletes.
//
//   node scripts/upload-r2-api.mjs [--dry-run] [--bucket surfaces-images] [--concurrency 12]
//
// If the OAuth token has expired, run `npx wrangler whoami` once to refresh it, then re-run.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'generated');
const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const DRY = args.includes('--dry-run');
const BUCKET = flag('--bucket', process.env.R2_BUCKET || 'surfaces-images');
const CONCURRENCY = Number(flag('--concurrency', 12));
const INCLUDE_DIRS = new Set(['sliver', 'thumb', 'medium', 'tex', 'large']);
const INCLUDE_FILES = new Set(['manifest.json']);
const TYPES = { '.webp': 'image/webp', '.jpg': 'image/jpeg', '.avif': 'image/avif', '.json': 'application/json', '.png': 'image/png' };

function wranglerConfigPath() {
  const candidates = [
    process.env.XDG_CONFIG_HOME && path.join(process.env.XDG_CONFIG_HOME, '.wrangler', 'config', 'default.toml'),
    process.env.APPDATA && path.join(process.env.APPDATA, 'xdg.config', '.wrangler', 'config', 'default.toml'),
    path.join(process.env.HOME || process.env.USERPROFILE || '', '.config', '.wrangler', 'config', 'default.toml'),
    path.join(process.env.HOME || process.env.USERPROFILE || '', '.wrangler', 'config', 'default.toml'),
  ].filter(Boolean);
  return candidates;
}
async function readToken() {
  for (const p of wranglerConfigPath()) {
    try {
      const t = await fs.readFile(p, 'utf8');
      const m = t.match(/^oauth_token\s*=\s*"([^"]+)"/m);
      if (m) return m[1];
    } catch { /* next */ }
  }
  throw new Error('No wrangler OAuth token found. Run `npx wrangler login` first.');
}
function refreshToken() {
  try { execFileSync('npx', ['wrangler', 'whoami'], { stdio: 'ignore', shell: true }); } catch { /* ignore */ }
}

let token = await readToken();
const accountId = process.env.CLOUDFLARE_ACCOUNT_ID || await (async () => {
  const r = await fetch('https://api.cloudflare.com/client/v4/accounts', { headers: { Authorization: `Bearer ${token}` } });
  const j = await r.json();
  if (!j.success || !j.result?.length) throw new Error('Could not list accounts: ' + JSON.stringify(j.errors));
  return j.result[0].id;
})();
const base = `https://api.cloudflare.com/client/v4/accounts/${accountId}/r2/buckets/${BUCKET}/objects`;

// Local files
const local = [];
for (const d of await fs.readdir(OUT, { withFileTypes: true })) {
  if (d.isDirectory() && INCLUDE_DIRS.has(d.name)) for (const f of await fs.readdir(path.join(OUT, d.name))) local.push(`${d.name}/${f}`);
  else if (d.isFile() && INCLUDE_FILES.has(d.name)) local.push(d.name);
}

// Remote etags
const remote = new Map();
let cursor = '';
do {
  const r = await fetch(`${base}?per_page=1000${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`, { headers: { Authorization: `Bearer ${token}` } });
  const j = await r.json();
  if (!j.success) throw new Error('List failed: ' + JSON.stringify(j.errors));
  for (const o of j.result || []) remote.set(o.key, (o.etag || '').replace(/"/g, ''));
  cursor = j.result_info?.is_truncated ? j.result_info.cursor : '';
} while (cursor);
console.log(`${local.length} local files, ${remote.size} already in bucket "${BUCKET}"`);

let uploaded = 0, skipped = 0, failed = 0, bytes = 0;
const queue = [...local];
async function put(key, buf, headers, attempt = 0) {
  const r = await fetch(`${base}/${key.split('/').map(encodeURIComponent).join('/')}`, {
    method: 'PUT', body: buf,
    headers: { Authorization: `Bearer ${token}`, ...headers },
  });
  if (r.ok) return;
  const text = await r.text();
  if ((r.status === 401 || r.status === 403) && attempt < 2) { refreshToken(); token = await readToken(); return put(key, buf, headers, attempt + 1); }
  if (r.status >= 500 && attempt < 3) { await new Promise((res) => setTimeout(res, 1000 * (attempt + 1))); return put(key, buf, headers, attempt + 1); }
  throw new Error(`HTTP ${r.status}: ${text.slice(0, 200)}`);
}
async function worker() {
  while (queue.length) {
    const key = queue.shift();
    const buf = await fs.readFile(path.join(OUT, key));
    const md5 = crypto.createHash('md5').update(buf).digest('hex');
    if (remote.get(key) === md5) { skipped++; continue; }
    if (DRY) { console.log(`would upload ${key} (${(buf.length / 1024).toFixed(0)} KB)`); uploaded++; continue; }
    const isManifest = key === 'manifest.json';
    try {
      await put(key, buf, {
        'Content-Type': TYPES[path.extname(key)] || 'application/octet-stream',
        'Cache-Control': isManifest ? 'public, max-age=300' : 'public, max-age=31536000, immutable',
      });
      uploaded++; bytes += buf.length;
    } catch (err) { failed++; process.stdout.write(`\n  !! ${key}: ${err.message}\n`); }
    process.stdout.write(`\r${uploaded} uploaded (${(bytes / 1048576).toFixed(0)} MB), ${skipped} unchanged, ${failed} failed  ${key.padEnd(44)}`);
  }
}
await Promise.all(Array.from({ length: CONCURRENCY }, worker));
console.log(`\n${DRY ? 'Would upload' : 'Uploaded'} ${uploaded} file(s)${DRY ? '' : ` (${(bytes / 1048576).toFixed(1)} MB)`}, ${skipped} unchanged, ${failed} failed, ${local.length} total.`);
if (failed) process.exitCode = 1;

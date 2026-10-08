#!/usr/bin/env node
// Local management app for the texture library (owner-only, never deployed).
//   npm run manage            -> http://localhost:5180
//
// What it does:
//   - shows every processed photo (incl. hidden) in spectrum order with its derivatives
//   - hide/unhide, title, tags, featured, manual hue  -> written to content/photos.yaml
//   - add new source files into Textures/ (never overwrites, never deletes anything there)
//   - "Scan" runs the image pipeline; "Publish" runs pipeline + upload --prune
// Hidden photos are removed from the site and from the R2 bucket (on publish --prune);
// the original file stays in Textures/.
import http from 'node:http';
import fs from 'node:fs/promises';
import fss from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'Textures');
const OUT = path.join(ROOT, 'generated');
const YAML_FILE = path.join(ROOT, 'content', 'photos.yaml');
const UI = path.join(ROOT, 'scripts', 'manage-ui.html');
const PORT = Number(process.env.PORT || 5180);
const PHOTO_EXT = /\.(jpe?g|cr2|png|tiff?|heic)$/i;

const json = (res, code, data) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data)); };
const readBody = (req) => new Promise((resolve, reject) => { const c = []; req.on('data', (d) => c.push(d)); req.on('end', () => resolve(Buffer.concat(c))); req.on('error', reject); });

// ---------------------------------------------------------------- photos.yaml editing (comments preserved)
async function loadDoc() {
  const text = await fs.readFile(YAML_FILE, 'utf8').catch(() => '');
  const doc = YAML.parseDocument(text || '{}');
  if (!doc.contents || !YAML.isMap(doc.contents)) doc.contents = doc.createNode({});
  doc.contents.flow = false; // block style, one entry per photo
  return doc;
}
async function patchPhoto(stem, patch) {
  const doc = await loadDoc();
  const map = doc.contents;
  if (patch.featured === true) {
    for (const item of map.items) if (YAML.isMap(item.value)) item.value.delete('featured');
  }
  let entry = map.get(stem, true);
  if (!entry || !YAML.isMap(entry)) { entry = doc.createNode({}); entry.flow = false; map.set(stem, entry); }
  const setOrDelete = (k, v, keep) => { if (keep) entry.set(k, v); else entry.delete(k); };
  if ('hidden' in patch) setOrDelete('hidden', true, !!patch.hidden);
  if ('featured' in patch) setOrDelete('featured', true, !!patch.featured);
  if ('title' in patch) setOrDelete('title', String(patch.title).trim(), String(patch.title).trim().length > 0);
  if ('tags' in patch) {
    const tags = [...new Set((Array.isArray(patch.tags) ? patch.tags : String(patch.tags).split(/[,/]/)).map((t) => String(t).trim()).filter(Boolean))];
    if (tags.length) { const seq = doc.createNode(tags); seq.flow = true; entry.set('tags', seq); } else entry.delete('tags');
  }
  if ('hue' in patch) {
    const h = patch.hue;
    if (h === 'neutral') entry.set('hue', 'neutral');
    else if (h === '' || h == null) entry.delete('hue');
    else entry.set('hue', Number(h));
  }
  if (entry.items.length === 0) map.delete(stem);
  await fs.writeFile(YAML_FILE, doc.toString({ lineWidth: 0 }));
  return doc.toJSON() || {};
}

// ---------------------------------------------------------------- catalog
async function catalog() {
  const cat = JSON.parse(await fs.readFile(path.join(OUT, 'catalog.json'), 'utf8').catch(() => '{"photos":[],"variants":[],"nearDuplicates":[],"errors":[]}'));
  const overrides = YAML.parse(await fs.readFile(YAML_FILE, 'utf8').catch(() => '')) || {};
  const known = new Set(cat.photos.map((p) => p.source.toLowerCase()));
  const collapsed = new Set(cat.variants.flatMap((v) => v.files.map((f) => f.toLowerCase())));
  const files = await fs.readdir(SRC);
  const pending = files.filter((f) => PHOTO_EXT.test(f) && !known.has(f.toLowerCase()) && !collapsed.has(f.toLowerCase()));
  // Apply unsaved-but-written overrides live (so the UI reflects photos.yaml before the next scan)
  for (const p of cat.photos) {
    const ov = overrides[p.stem] || overrides[p.id] || {};
    p.hidden = !!ov.hidden; p.featured = !!ov.featured;
    p.title = typeof ov.title === 'string' ? ov.title : ''; p.tags = Array.isArray(ov.tags) ? ov.tags.map(String) : [];
    p.hueOverride = ov.hue ?? null;
  }
  const tags = {};
  for (const p of cat.photos) if (!p.hidden) for (const t of p.tags) tags[t] = (tags[t] || 0) + 1;
  return { ...cat, pending, tags, sourceCount: files.filter((f) => PHOTO_EXT.test(f)).length };
}

// ---------------------------------------------------------------- long-running tasks (streamed)
let running = null;
function runTask(res, steps) {
  if (running) { res.writeHead(409, { 'Content-Type': 'text/plain' }); res.end('A task is already running.\n'); return; }
  res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' });
  const next = (i) => {
    if (i >= steps.length) { res.end('\n[done]\n'); running = null; return; }
    const [label, cmd, args] = steps[i];
    res.write(`\n$ ${label}\n`);
    const child = spawn(cmd, args, { cwd: ROOT, shell: false, env: { ...process.env } });
    running = child;
    child.stdout.on('data', (d) => res.write(d));
    child.stderr.on('data', (d) => res.write(d));
    child.on('close', (code) => { if (code !== 0) { res.end(`\n[failed: exit ${code}]\n`); running = null; } else next(i + 1); });
  };
  next(0);
}

// ---------------------------------------------------------------- server
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  try {
    if (req.method === 'GET' && url.pathname === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(await fs.readFile(UI)); return;
    }
    if (req.method === 'GET' && url.pathname === '/api/catalog') return json(res, 200, await catalog());
    if (req.method === 'POST' && url.pathname === '/api/photo') {
      const { stem, patch } = JSON.parse((await readBody(req)).toString('utf8'));
      if (!stem || typeof stem !== 'string' || !patch) return json(res, 400, { error: 'stem and patch required' });
      await patchPhoto(stem, patch);
      return json(res, 200, { ok: true });
    }
    if (req.method === 'POST' && url.pathname === '/api/add') {
      const name = path.basename(decodeURIComponent(req.headers['x-filename'] || ''));
      if (!name || !PHOTO_EXT.test(name)) return json(res, 400, { error: 'Unsupported file type (jpg, jpeg, cr2, png, tif, heic)' });
      const target = path.join(SRC, name);
      if (fss.existsSync(target)) return json(res, 409, { error: `${name} already exists in Textures/ (nothing overwritten)` });
      const body = await readBody(req);
      if (!body.length) return json(res, 400, { error: 'empty file' });
      await fs.writeFile(target, body, { flag: 'wx' });
      return json(res, 200, { ok: true, name, bytes: body.length });
    }
    if (req.method === 'POST' && url.pathname === '/api/run') {
      const { task } = JSON.parse((await readBody(req)).toString('utf8'));
      const node = process.execPath;
      if (task === 'scan') return runTask(res, [['node scripts/build-images.mjs', node, ['scripts/build-images.mjs']]]);
      if (task === 'publish') return runTask(res, [
        ['node scripts/build-images.mjs', node, ['scripts/build-images.mjs']],
        ['node scripts/upload-r2-api.mjs --prune', node, ['scripts/upload-r2-api.mjs', '--prune']],
      ]);
      return json(res, 400, { error: 'unknown task' });
    }
    if (req.method === 'GET' && url.pathname.startsWith('/img/')) {
      const rel = decodeURIComponent(url.pathname.slice(5));
      const file = path.join(OUT, rel);
      if (!file.startsWith(OUT) || !fss.existsSync(file)) { res.writeHead(404); return res.end(); }
      const type = { '.webp': 'image/webp', '.jpg': 'image/jpeg' }[path.extname(file)] || 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-cache' });
      fss.createReadStream(file).pipe(res); return;
    }
    res.writeHead(404); res.end('not found');
  } catch (err) {
    json(res, 500, { error: String(err.message || err) });
  }
});
const URL_ = `http://localhost:${PORT}`;
const OPEN = process.argv.includes('--open');
function openBrowser(url) {
  const cmd = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]]
    : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  try { spawn(cmd[0], cmd[1], { stdio: 'ignore', detached: true }).unref(); } catch { /* ignore */ }
}
server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.log(`Surfaces manager is already running at ${URL_}`);
    if (OPEN) openBrowser(URL_);
    process.exit(0);
  }
  console.error(err); process.exit(1);
});
server.listen(PORT, '127.0.0.1', () => {
  console.log(`Surfaces manager: ${URL_}  (library: ${SRC})`);
  console.log('Press Ctrl+C to stop.');
  if (OPEN) openBrowser(URL_);
});

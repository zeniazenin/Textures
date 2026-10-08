#!/usr/bin/env node
// Surfaces image pipeline: Textures/ (read-only) -> generated/ (git-ignored).
//   node scripts/build-images.mjs            incremental build
//   node scripts/build-images.mjs --force    rebuild everything
//   node scripts/build-images.mjs --large    also emit the optional 2400px "large" derivative
//   node scripts/build-images.mjs --avif     also emit AVIF next to WebP (slow)
// Never writes into Textures/.
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import YAML from 'yaml';
import exifReader from 'exif-reader';
import { encode as encodeBlurhash } from 'blurhash';
import { readCr2, orientationOps } from './cr2.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'Textures');
const OUT = path.join(ROOT, 'generated');
const CACHE_FILE = path.join(OUT, '.cache.json');
const args = new Set(process.argv.slice(2));
const FORCE = args.has('--force');
const WANT_LARGE = args.has('--large');
const WANT_AVIF = args.has('--avif');
const CONCURRENCY = Math.max(1, Math.min(4, os.cpus().length - 1));
const PIPELINE_VERSION = 3; // bump to invalidate the cache after changing processing

const SIZES = {
  sliver: { edge: 160 },
  thumb: { edge: 400 },
  medium: { edge: 1200 },
  tex: { edge: 2048, square: true },
  ...(WANT_LARGE ? { large: { edge: 2400 } } : {}),
};
const QUALITY = { webp: 82, jpg: 84, avif: 55 };

const site = JSON.parse(await fs.readFile(path.join(ROOT, 'content/site.json'), 'utf8'));
const overridesRaw = YAML.parse(await fs.readFile(path.join(ROOT, 'content/photos.yaml'), 'utf8')) || {};
const overrides = new Map(Object.entries(overridesRaw).map(([k, v]) => [k.toLowerCase(), v || {}]));

sharp.cache(false);
sharp.concurrency(1);

// ---------------------------------------------------------------- scan + group
const entries = (await fs.readdir(SRC, { withFileTypes: true })).filter((d) => d.isFile());
const photosExt = /\.(jpe?g|cr2)$/i;
const skipped = [];
const sources = [];
for (const d of entries) {
  if (!photosExt.test(d.name)) { skipped.push(d.name); continue; }
  const stem = d.name.replace(/\.[^.]+$/, '');
  const st = await fs.stat(path.join(SRC, d.name));
  sources.push({ file: d.name, stem, ext: d.name.split('.').pop().toLowerCase(), mtime: st.mtimeMs, size: st.size });
}

// Variant detection: "<base>_Original", "<base>-EDIT", "<base>-01" collapse onto <base>
// only when the base file itself exists. Otherwise every file is a standalone photo.
const variantRe = /^(.*?)(_Original|-EDIT|-0\d)$/i;
const kindOf = (stem) => {
  const m = stem.match(variantRe);
  if (!m) return { base: stem, kind: 'base', rank: 1 };
  const suffix = m[2].toLowerCase();
  return { base: m[1], kind: suffix, rank: suffix === '-edit' ? 3 : suffix.startsWith('-0') ? 2 : 0 };
};
const groups = new Map();
for (const s of sources) {
  const k = kindOf(s.stem);
  const key = k.base.toLowerCase();
  if (!groups.has(key)) groups.set(key, []);
  groups.get(key).push({ ...s, ...k });
}
const published = [];
const variantReport = [];
for (const [, members] of groups) {
  const hasBase = members.some((m) => m.kind === 'base');
  if (members.length === 1 || !hasBase) { published.push(...members); continue; }
  const base = members.find((m) => m.kind === 'base');
  const ov = overrides.get(base.stem.toLowerCase()) || {};
  let chosen;
  if (ov.prefer) chosen = members.find((m) => m.stem.toLowerCase() === String(ov.prefer).toLowerCase() || m.file.toLowerCase() === String(ov.prefer).toLowerCase());
  if (!chosen) chosen = [...members].sort((a, b) => b.rank - a.rank || (a.ext === 'cr2') - (b.ext === 'cr2'))[0];
  published.push(chosen);
  variantReport.push({ group: base.stem, files: members.map((m) => m.file), chosen: chosen.file, via: ov.prefer ? 'photos.yaml prefer' : 'default rule' });
}

// ---------------------------------------------------------------- helpers
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
const fromFilename = (stem) => {
  const m = stem.match(/(20\d{2})(\d{2})(\d{2})[_-]?(\d{2})(\d{2})(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}` : null;
};
const exifDate = (s) => (s && /^\d{4}:\d{2}:\d{2} \d{2}:\d{2}:\d{2}$/.test(s) ? s.replace(/^(\d{4}):(\d{2}):(\d{2}) /, '$1-$2-$3T') : null);
const hex = (r, g, b) => '#' + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');

function analyse(px, w, h) {
  // px: RGB bytes. Saturation-weighted circular mean hue (SPEC section 4.3).
  let sr = 0, sg = 0, sb = 0, cx = 0, cy = 0, wsum = 0, lsum = 0;
  const n = w * h;
  for (let i = 0; i < n; i++) {
    const r = px[i * 3] / 255, g = px[i * 3 + 1] / 255, b = px[i * 3 + 2] / 255;
    sr += r; sg += g; sb += b;
    const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
    const l = (max + min) / 2;
    lsum += l;
    if (d < 1e-6) continue;
    const s = d / (1 - Math.abs(2 * l - 1));
    const weight = s * (1 - Math.abs(2 * l - 1));
    let hue;
    if (max === r) hue = ((g - b) / d) % 6;
    else if (max === g) hue = (b - r) / d + 2;
    else hue = (r - g) / d + 4;
    hue *= Math.PI / 3;
    cx += weight * Math.cos(hue); cy += weight * Math.sin(hue); wsum += weight;
  }
  let hue = (Math.atan2(cy, cx) * 180) / Math.PI;
  if (hue < 0) hue += 360;
  return {
    color: hex((sr / n) * 255, (sg / n) * 255, (sb / n) * 255),
    hue: Math.round(hue * 10) / 10,
    chroma: Math.round((wsum / n) * 1000) / 1000,
    lightness: Math.round((lsum / n) * 1000) / 1000,
  };
}

function dHash(gray, w) {
  // 9x8 grayscale -> 64-bit hash as hex (near-duplicate detection)
  let bits = '';
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) bits += gray[y * w + x] < gray[y * w + x + 1] ? '1' : '0';
  return BigInt('0b' + bits).toString(16).padStart(16, '0');
}
const hamming = (a, b) => { let x = BigInt('0x' + a) ^ BigInt('0x' + b), c = 0; while (x) { c += Number(x & 1n); x >>= 1n; } return c; };

async function decode(src) {
  const file = path.join(SRC, src.file);
  let img, dateTime = null, note = null;
  // Sniff the real container: a couple of ".CR2" files in the library are plain JPEGs.
  const head = Buffer.alloc(4);
  const fh = await fs.open(file, 'r'); await fh.read(head, 0, 4, 0); await fh.close();
  const isTiff = head.toString('ascii', 0, 2) === 'II' || head.toString('ascii', 0, 2) === 'MM';
  if (src.ext === 'cr2' && !isTiff) note = 'CR2 extension but JPEG content';
  if (src.ext === 'cr2' && isTiff) {
    const cr2 = await readCr2(file);
    const ops = orientationOps(cr2.orientation);
    img = sharp(cr2.jpeg, { failOn: 'none' });
    if (ops.rotate) img = img.rotate(ops.rotate);
    if (ops.flip) img = img.flip();
    if (ops.flop) img = img.flop();
    dateTime = exifDate(cr2.dateTime);
    note = 'embedded JPEG from CR2';
  } else {
    img = sharp(file, { failOn: 'none', limitInputPixels: false }).rotate(); // apply EXIF orientation
    const meta = await sharp(file, { failOn: 'none', limitInputPixels: false }).metadata();
    if (meta.exif) {
      try {
        const ex = exifReader(meta.exif);
        const d = ex?.Photo?.DateTimeOriginal || ex?.Image?.DateTime;
        if (d instanceof Date) dateTime = d.toISOString().slice(0, 19);
        else if (typeof d === 'string') dateTime = exifDate(d);
      } catch { /* ignore broken EXIF */ }
    }
  }
  // Materialise once (oriented, sRGB, metadata dropped) so every derivative starts from the same pixels.
  const base = await img.withIccProfile('srgb', { attach: false }).toColourspace('srgb').png({ compressionLevel: 0 }).toBuffer({ resolveWithObject: true });
  return { buffer: base.data, width: base.info.width, height: base.info.height, dateTime, note };
}

async function writeDerivatives(id, base) {
  const out = {};
  for (const [name, cfg] of Object.entries(SIZES)) {
    let s = sharp(base.buffer, { limitInputPixels: false });
    s = cfg.square
      ? s.resize(cfg.edge, cfg.edge, { fit: 'cover', position: 'centre', withoutEnlargement: false })
      : s.resize(cfg.edge, cfg.edge, { fit: 'inside', withoutEnlargement: true });
    const dir = path.join(OUT, name);
    await fs.mkdir(dir, { recursive: true });
    const info = await s.clone().webp({ quality: QUALITY.webp, effort: 4 }).toFile(path.join(dir, `${id}.webp`));
    await s.clone().jpeg({ quality: QUALITY.jpg, mozjpeg: true, progressive: true }).toFile(path.join(dir, `${id}.jpg`));
    if (WANT_AVIF) await s.clone().avif({ quality: QUALITY.avif, effort: 4 }).toFile(path.join(dir, `${id}.avif`));
    out[name] = { w: info.width, h: info.height };
  }
  return out;
}

async function processOne(src, cache) {
  const id = slug(src.stem);
  const key = src.file;
  const stamp = { mtime: src.mtime, size: src.size, v: PIPELINE_VERSION, sizes: Object.keys(SIZES).join(','), avif: WANT_AVIF };
  const cached = cache[key];
  const outputsExist = async () => {
    for (const name of Object.keys(SIZES)) {
      try { await fs.access(path.join(OUT, name, `${id}.webp`)); await fs.access(path.join(OUT, name, `${id}.jpg`)); } catch { return false; }
    }
    return true;
  };
  if (!FORCE && cached && JSON.stringify(cached.stamp) === JSON.stringify(stamp) && (await outputsExist())) {
    return { ...cached.data, id, file: src.file, cached: true };
  }
  const t0 = Date.now();
  const base = await decode(src);
  const sizes = await writeDerivatives(id, base);
  const small = await sharp(base.buffer, { limitInputPixels: false }).resize(64, 64, { fit: 'fill' }).removeAlpha().raw().toBuffer();
  const analysis = analyse(small, 64, 64);
  const bh = await sharp(base.buffer, { limitInputPixels: false }).resize(32, 32, { fit: 'fill' }).ensureAlpha().raw().toBuffer();
  const blurhash = encodeBlurhash(new Uint8ClampedArray(bh), 32, 32, 4, 3);
  const g = await sharp(base.buffer, { limitInputPixels: false }).resize(9, 8, { fit: 'fill' }).grayscale().raw().toBuffer();
  const data = {
    width: base.width, height: base.height, aspect: Math.round((base.width / base.height) * 1000) / 1000,
    takenAt: base.dateTime || fromFilename(src.stem),
    ...analysis, blurhash, dhash: dHash(g, 9), sizes, source: src.file, sourceNote: base.note,
  };
  cache[key] = { stamp, data };
  return { ...data, id, file: src.file, cached: false, ms: Date.now() - t0 };
}

// ---------------------------------------------------------------- run
await fs.mkdir(OUT, { recursive: true });
let cache = {};
if (!FORCE) { try { cache = JSON.parse(await fs.readFile(CACHE_FILE, 'utf8')); } catch { cache = {}; } }

published.sort((a, b) => a.file.localeCompare(b.file));
const results = [];
let done = 0, idx = 0;
const total = published.length;
async function worker() {
  while (idx < published.length) {
    const src = published[idx++];
    try {
      const r = await processOne(src, cache);
      results.push(r);
      done++;
      process.stdout.write(`\r[${String(done).padStart(3)}/${total}] ${r.cached ? 'cached ' : `${String(r.ms).padStart(5)}ms`}  ${src.file.padEnd(40)}`);
      if (done % 10 === 0) await fs.writeFile(CACHE_FILE, JSON.stringify(cache));
    } catch (err) {
      done++;
      results.push({ id: slug(src.stem), file: src.file, error: String(err.message || err) });
      process.stdout.write(`\n  !! ${src.file}: ${err.message}\n`);
    }
  }
}
console.log(`Surfaces pipeline: ${total} photos to publish (${sources.length} source files, ${variantReport.length} variant groups collapsed), concurrency ${CONCURRENCY}${FORCE ? ', FORCE' : ''}`);
await Promise.all(Array.from({ length: CONCURRENCY }, worker));
await fs.writeFile(CACHE_FILE, JSON.stringify(cache));
process.stdout.write('\n');

// ---------------------------------------------------------------- manifest
const errors = results.filter((r) => r.error);
const ok = results.filter((r) => !r.error);
const neutralChroma = site.spectrum?.neutralChroma ?? 0.06;
const hueStart = site.spectrum?.hueStart ?? 0;
const bandsCfg = site.spectrum?.bands ?? [];
const rel = (h) => (((h - hueStart) % 360) + 360) % 360; // hue relative to the spectrum start

const photos = [];
let hiddenCount = 0;
for (const r of ok) {
  const stem = r.file.replace(/\.[^.]+$/, '');
  const ov = overrides.get(stem.toLowerCase()) || overrides.get(r.id) || overrides.get(kindOf(stem).base.toLowerCase()) || {};
  if (ov.hidden) { hiddenCount++; continue; }
  let hue = r.hue, neutral = r.chroma < neutralChroma;
  if (ov.hue === 'neutral') neutral = true;
  else if (typeof ov.hue === 'number') { hue = ((ov.hue % 360) + 360) % 360; neutral = false; }
  photos.push({
    id: r.id, source: r.file, title: typeof ov.title === 'string' ? ov.title : '',
    tags: Array.isArray(ov.tags) ? ov.tags.map(String) : [],
    featured: !!ov.featured,
    width: r.width, height: r.height, aspect: r.aspect, takenAt: r.takenAt,
    color: r.color, hue, chroma: r.chroma, lightness: r.lightness, neutral, blurhash: r.blurhash,
    seed: parseInt(r.dhash.slice(0, 6), 16) % 1000,
    sizes: r.sizes, _dhash: r.dhash,
  });
}
photos.sort((a, b) => {
  if (a.neutral !== b.neutral) return a.neutral ? 1 : -1;
  if (a.neutral) return b.lightness - a.lightness; // neutrals: light -> dark
  return rel(a.hue) - rel(b.hue) || a.id.localeCompare(b.id);
});
photos.forEach((p, i) => { p.no = i + 1; });

// Band boundaries (fractions of the list) for the axis labels.
const chromatic = photos.filter((p) => !p.neutral);
const bands = [];
if (chromatic.length) {
  const sortedBands = bandsCfg.map(([label, start]) => ({ label, start: rel(start) })).sort((a, b) => a.start - b.start);
  for (let i = 0; i < sortedBands.length; i++) {
    const from = sortedBands[i].start, to = i + 1 < sortedBands.length ? sortedBands[i + 1].start : 360;
    const first = chromatic.findIndex((p) => rel(p.hue) >= from && rel(p.hue) < to);
    if (first < 0) continue;
    const count = chromatic.filter((p) => rel(p.hue) >= from && rel(p.hue) < to).length;
    bands.push({ label: sortedBands[i].label, start: first / photos.length, count });
  }
}
if (photos.length > chromatic.length) bands.push({ label: 'Neutrals', start: chromatic.length / photos.length, count: photos.length - chromatic.length });

// Near-duplicates (report only; owner decides via photos.yaml `hidden`).
const nearDupes = [];
for (let i = 0; i < photos.length; i++) for (let j = i + 1; j < photos.length; j++) {
  const d = hamming(photos[i]._dhash, photos[j]._dhash);
  if (d <= 6) nearDupes.push({ a: photos[i].source, b: photos[j].source, distance: d });
}
const tagCounts = {};
for (const p of photos) for (const t of p.tags) tagCounts[t] = (tagCounts[t] || 0) + 1;

const manifest = {
  generatedAt: new Date().toISOString(),
  site: { name: site.name, tagline: site.tagline, description: site.description, footer: site.footer, heroEyebrowTags: site.heroEyebrowTags, accent: site.accent, featured: site.featured },
  sizes: Object.fromEntries(Object.entries(SIZES).map(([k, v]) => [k, v.edge])),
  formats: ['webp', 'jpg', ...(WANT_AVIF ? ['avif'] : [])],
  count: photos.length,
  bands,
  tags: tagCounts,
  photos: photos.map(({ _dhash, ...p }) => p),
};
await fs.writeFile(path.join(OUT, 'manifest.json'), JSON.stringify(manifest));
await fs.writeFile(path.join(OUT, 'manifest.pretty.json'), JSON.stringify(manifest, null, 2));

const md = [
  `# Build report (${manifest.generatedAt})`, '',
  `- Source files scanned: ${sources.length} (skipped non-photo: ${skipped.join(', ') || 'none'})`,
  `- Published photos: ${photos.length}${errors.length ? `, **errors: ${errors.length}**` : ''}`,
  `- Neutral band: ${photos.length - chromatic.length} photos (chroma < ${neutralChroma})`,
  `- Hidden via photos.yaml: ${hiddenCount}`,
  '', '## Variant groups collapsed', '',
  ...(variantReport.length ? variantReport.map((v) => `- **${v.group}**: ${v.files.join(', ')} -> published \`${v.chosen}\` (${v.via})`) : ['- none']),
  '', '## Possible near-duplicates (not auto-hidden)', '',
  ...(nearDupes.length ? nearDupes.map((d) => `- ${d.a} ~ ${d.b} (distance ${d.distance})`) : ['- none']),
  '', '## Errors', '', ...(errors.length ? errors.map((e) => `- ${e.file}: ${e.error}`) : ['- none']), '',
  '## Spectrum bands', '', ...bands.map((b) => `- ${b.label}: ${b.count} photos, starts at ${(b.start * 100).toFixed(1)}%`), '',
].join('\n');
await fs.writeFile(path.join(OUT, 'report.md'), md);
console.log(`manifest.json: ${photos.length} photos, ${bands.map((b) => `${b.label} ${b.count}`).join(' / ')}`);
if (nearDupes.length) console.log(`${nearDupes.length} possible near-duplicate pair(s), see generated/report.md`);
if (errors.length) { console.error(`${errors.length} error(s), see generated/report.md`); process.exitCode = 1; }

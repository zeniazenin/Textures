#!/usr/bin/env node
// Renders generated/contact-sheet.jpg: every published photo as a thumbnail in
// spectrum order, with a hue swatch and the "No." under each. For the owner to
// sanity-check hue sorting and the neutral threshold before the UI is built.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'generated');
const manifest = JSON.parse(await fs.readFile(path.join(OUT, 'manifest.json'), 'utf8'));

const CELL_W = 120, CELL_H = 160, SWATCH = 10, LABEL = 18, PAD = 6;
const COLS = 20;
const cellH = CELL_H + SWATCH + LABEL + PAD;
const rows = Math.ceil(manifest.photos.length / COLS);
const W = COLS * (CELL_W + PAD) + PAD, H = rows * cellH + PAD + 40;

const hsl = (h, s, l) => `hsl(${h.toFixed(0)}, ${s}%, ${l}%)`;
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
const composites = [];
let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><rect width="100%" height="100%" fill="#131211"/>`;
svg += `<text x="${PAD}" y="26" font-family="monospace" font-size="18" fill="#ECE7DF">${esc(manifest.site.name)} contact sheet — ${manifest.count} photos in spectrum order — ${manifest.bands.map((b) => `${b.label} ${b.count}`).join(' · ')}</text>`;

for (let i = 0; i < manifest.photos.length; i++) {
  const p = manifest.photos[i];
  const x = PAD + (i % COLS) * (CELL_W + PAD), y = 40 + PAD + Math.floor(i / COLS) * cellH;
  const thumb = await sharp(path.join(OUT, 'thumb', `${p.id}.jpg`)).resize(CELL_W, CELL_H, { fit: 'cover' }).toBuffer();
  composites.push({ input: thumb, left: x, top: y });
  const swatch = p.neutral ? '#777' : hsl(p.hue, 80, 50);
  svg += `<rect x="${x}" y="${y + CELL_H}" width="${CELL_W}" height="${SWATCH}" fill="${swatch}"/>`;
  svg += `<rect x="${x}" y="${y + CELL_H + 2}" width="${Math.round(Math.min(1, p.chroma / 0.4) * CELL_W)}" height="${SWATCH - 4}" fill="${p.color}"/>`;
  svg += `<text x="${x + 2}" y="${y + CELL_H + SWATCH + 13}" font-family="monospace" font-size="11" fill="#A39C92">${String(p.no).padStart(3, '0')} ${p.neutral ? 'N' : 'h' + Math.round(p.hue)} c${p.chroma.toFixed(2)}</text>`;
}
svg += '</svg>';
const base = await sharp(Buffer.from(svg)).png().toBuffer();
await sharp(base).composite(composites).jpeg({ quality: 80 }).toFile(path.join(OUT, 'contact-sheet.jpg'));
console.log(`generated/contact-sheet.jpg (${W}x${H}, ${manifest.count} photos)`);

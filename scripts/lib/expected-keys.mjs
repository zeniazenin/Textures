// The set of object keys that should exist in the image bucket: every derivative of every
// published (non-hidden) photo in generated/manifest.json, plus manifest.json itself.
import fs from 'node:fs/promises';
import path from 'node:path';

export async function expectedKeys(outDir) {
  const manifest = JSON.parse(await fs.readFile(path.join(outDir, 'manifest.json'), 'utf8'));
  const keys = new Set(['manifest.json']);
  for (const p of manifest.photos) for (const size of Object.keys(manifest.sizes)) for (const fmt of manifest.formats) keys.add(`${size}/${p.id}.${fmt}`);
  return { manifest, keys };
}

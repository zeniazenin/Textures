#!/usr/bin/env node
// Sync generated/ (derivatives + manifest.json) to a Cloudflare R2 bucket via the S3 API.
// Incremental: skips objects whose ETag (MD5) already matches. Never deletes.
//
//   node scripts/upload-r2.mjs            upload changed files
//   node scripts/upload-r2.mjs --dry-run  list what would be uploaded
//
// Required env (put them in .env, see .env.example):
//   R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { S3Client, PutObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'generated');
const DRY = process.argv.includes('--dry-run');

// Tiny .env loader (no dependency)
try {
  const env = await fs.readFile(path.join(ROOT, '.env'), 'utf8');
  for (const line of env.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
} catch { /* no .env */ }

const { R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET } = process.env;
if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY || !R2_BUCKET) {
  console.error('Missing R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY / R2_BUCKET (see .env.example)');
  process.exit(1);
}

const s3 = new S3Client({
  region: 'auto',
  endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY },
});

const TYPES = { '.webp': 'image/webp', '.jpg': 'image/jpeg', '.avif': 'image/avif', '.json': 'application/json', '.png': 'image/png' };
const INCLUDE_DIRS = new Set(['sliver', 'thumb', 'medium', 'tex', 'large']);
const INCLUDE_FILES = new Set(['manifest.json']);

// Collect local files
const local = [];
for (const d of await fs.readdir(OUT, { withFileTypes: true })) {
  if (d.isDirectory() && INCLUDE_DIRS.has(d.name)) {
    for (const f of await fs.readdir(path.join(OUT, d.name))) local.push(`${d.name}/${f}`);
  } else if (d.isFile() && INCLUDE_FILES.has(d.name)) local.push(d.name);
}

// Remote ETags
const remote = new Map();
let token;
do {
  const res = await s3.send(new ListObjectsV2Command({ Bucket: R2_BUCKET, ContinuationToken: token }));
  for (const o of res.Contents || []) remote.set(o.Key, (o.ETag || '').replace(/"/g, ''));
  token = res.IsTruncated ? res.NextContinuationToken : undefined;
} while (token);

let uploaded = 0, skipped = 0, bytes = 0;
const queue = [...local];
async function worker() {
  while (queue.length) {
    const key = queue.shift();
    const buf = await fs.readFile(path.join(OUT, key));
    const md5 = crypto.createHash('md5').update(buf).digest('hex');
    if (remote.get(key) === md5) { skipped++; continue; }
    const ext = path.extname(key);
    const isManifest = key === 'manifest.json';
    if (DRY) { console.log(`would upload ${key} (${(buf.length / 1024).toFixed(0)} KB)`); uploaded++; continue; }
    await s3.send(new PutObjectCommand({
      Bucket: R2_BUCKET, Key: key, Body: buf, ContentType: TYPES[ext] || 'application/octet-stream',
      // Derivatives are content-addressed by id and rebuilt rarely: cache for a year. Manifest: 5 minutes.
      CacheControl: isManifest ? 'public, max-age=300' : 'public, max-age=31536000, immutable',
    }));
    uploaded++; bytes += buf.length;
    process.stdout.write(`\r${uploaded} uploaded, ${skipped} unchanged  ${key.padEnd(48)}`);
  }
}
await Promise.all(Array.from({ length: 8 }, worker));
console.log(`\n${DRY ? 'Would upload' : 'Uploaded'} ${uploaded} file(s)${DRY ? '' : ` (${(bytes / 1048576).toFixed(1)} MB)`}, ${skipped} unchanged, ${local.length} total.`);

import { defineConfig, type Plugin } from 'vite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// In dev/preview, serve the git-ignored generated/ folder at /generated so the site
// works locally without uploading anything. In production the images come from
// VITE_IMAGE_BASE (the R2 bucket's custom domain).
function serveGenerated(): Plugin {
  const dir = path.resolve(__dirname, 'generated');
  const types: Record<string, string> = { '.webp': 'image/webp', '.jpg': 'image/jpeg', '.avif': 'image/avif', '.json': 'application/json', '.png': 'image/png' };
  const handler = (req: any, res: any, next: () => void) => {
    const url = (req.url || '').split('?')[0];
    if (!url.startsWith('/generated/')) return next();
    const file = path.join(dir, decodeURIComponent(url.slice('/generated/'.length)));
    if (!file.startsWith(dir) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.statusCode = 404; return res.end('not found'); }
    res.setHeader('Content-Type', types[path.extname(file)] || 'application/octet-stream');
    res.setHeader('Cache-Control', 'no-cache');
    fs.createReadStream(file).pipe(res);
  };
  return {
    name: 'serve-generated',
    configureServer(server) { server.middlewares.use(handler); },
    configurePreviewServer(server) { server.middlewares.use(handler); },
  };
}

export default defineConfig({
  plugins: [serveGenerated()],
  build: { target: 'es2020', sourcemap: false },
  server: { port: 5173, open: false },
});

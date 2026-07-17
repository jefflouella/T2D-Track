import * as esbuild from 'esbuild';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const outdir = path.join(root, 'public', 'assets');

fs.mkdirSync(outdir, { recursive: true });

await esbuild.build({
  entryPoints: {
    app: path.join(root, 'src/client/app.js'),
    sw: path.join(root, 'src/client/sw.js'),
  },
  bundle: true,
  outdir,
  format: 'esm',
  sourcemap: true,
  target: ['es2022'],
  entryNames: '[name]',
});

// Copy service worker to public root for correct scope
fs.copyFileSync(path.join(outdir, 'sw.js'), path.join(root, 'public', 'sw.js'));

console.log('Assets built to public/assets');

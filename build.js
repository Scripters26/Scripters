
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const root = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(root, 'public');

// Validate JavaScript files.
const jsFiles = [
  'server.js',
  'main.js',
  'media.config.js'
];

for (const file of jsFiles) {
  if (fs.existsSync(path.join(root, file))) {
    execSync(`node --check "${file}"`, {
      cwd: root,
      stdio: 'inherit'
    });
  }
}

// Start with a clean production directory.
fs.mkdirSync(publicDir, { recursive: true });
for (const entry of fs.readdirSync(publicDir)) {
  fs.rmSync(path.join(publicDir, entry), { recursive: true, force: true });
}

// Copy frontend entrypoint files.
const rootFiles = [
  'index.html',
  'style.css',
  'main.js',
  'media.config.js',
  'CNAME'
];

for (const file of rootFiles) {
  const src = path.join(root, file);

  if (fs.existsSync(src) && fs.statSync(src).isFile()) {
    fs.copyFileSync(src, path.join(publicDir, file));
  }
}

// Copy every required asset directory recursively.
const assetDirs = [
  'assets',
  'frames',
  'team',
  'work'
];

for (const dir of assetDirs) {
  const src = path.join(root, dir);

  if (fs.existsSync(src) && fs.statSync(src).isDirectory()) {
    fs.cpSync(src, path.join(publicDir, dir), {
      recursive: true,
      force: true
    });

    console.log(`Copied ${dir}/`);
  }
}

// Copy root-level PDF documents.
for (const file of fs.readdirSync(root)) {
  const src = path.join(root, file);

  if (
    fs.statSync(src).isFile() &&
    path.extname(file).toLowerCase() === '.pdf'
  ) {
    fs.copyFileSync(src, path.join(publicDir, file));
    console.log(`Copied ${file}`);
  }
}

// Disable Jekyll processing for GitHub Pages deployments.
fs.writeFileSync(path.join(publicDir, '.nojekyll'), '');

// Verify the production entrypoint.
if (!fs.existsSync(path.join(publicDir, 'index.html'))) {
  throw new Error('Production index.html is missing!');
}

console.log('Build completed successfully.');
console.log('Production output:', publicDir);

// Stamp a content version onto every module so browsers can never serve a
// half-updated mix of old and new files.
//
// The problem: index.html only ever versioned js/main.js. Every other module
// is imported by plain relative path, so a browser caches each one separately
// and a reload can hand the page new main.js alongside a stale Game.js — a
// broken hybrid build that looks like the game itself is broken.
//
// The fix: an import map that rewrites every local module specifier to carry
// the same ?v= tag. One version changes, the whole graph refetches together.
// Import maps resolve relative to the document, so the same file works both on
// localhost and under a GitHub Pages subpath.
//
// Usage:  node tools/stamp-version.mjs [--check]
//   --check  exit 1 if the stamp is stale (for CI), change nothing

import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readdirSync, statSync } from 'node:fs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const INDEX = join(ROOT, 'index.html');

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (name.endsWith('.js')) out.push(p);
  }
  return out;
}

// Every module the page can load, plus the stylesheet (which is also cached).
const files = [
  ...walk(join(ROOT, 'js')),
  join(ROOT, 'assets', 'vendor', 'three.module.js'),
].sort();
const styles = join(ROOT, 'styles.css');

// Version = hash of all of it, so it changes exactly when the code changes.
const h = createHash('sha256');
for (const f of files) h.update(readFileSync(f));
h.update(readFileSync(styles));
const version = h.digest('hex').slice(0, 10);

// Build the import map: bare "three" plus one entry per local module.
const imports = { three: `./assets/vendor/three.module.js?v=${version}` };
for (const f of files) {
  const rel = './' + relative(ROOT, f).split('\\').join('/');
  imports[rel] = `${rel}?v=${version}`;
}
const mapJson = JSON.stringify({ imports }, null, 6)
  .split('\n').map((l, i) => (i === 0 ? l : '  ' + l)).join('\n');

let html = readFileSync(INDEX, 'utf8');
const before = html;

html = html.replace(
  /<script type="importmap">[\s\S]*?<\/script>/,
  `<script type="importmap">\n  ${mapJson}\n  </script>`
);
html = html.replace(
  /(<script type="module" src="js\/main\.js)(\?v=[0-9a-f]*)?(")/,
  `$1?v=${version}$3`
);
html = html.replace(
  /(<link rel="stylesheet" href="styles\.css)(\?v=[0-9a-f]*)?(")/,
  `$1?v=${version}$3`
);

if (process.argv.includes('--check')) {
  if (html !== before) {
    console.error(`Version stamp is stale. Run: node tools/stamp-version.mjs`);
    process.exit(1);
  }
  console.log(`Version stamp is current (${version}).`);
  process.exit(0);
}

if (html === before) {
  console.log(`Already stamped ${version} — nothing to do.`);
} else {
  writeFileSync(INDEX, html);
  console.log(`Stamped version ${version} across ${files.length} modules + styles.css.`);
}

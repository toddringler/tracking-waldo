#!/usr/bin/env node
/**
 * Script 3: Site Build
 *
 * Copies all public/ files into /docs/ for GitHub Pages deployment.
 * Ensures the deployment folder is always in sync with the build output.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const DOCS_DIR = path.join(__dirname, '..', 'docs');

function copyRecursive(src, dest) {
  const stat = fs.statSync(src);

  if (stat.isDirectory()) {
    if (!fs.existsSync(dest)) {
      fs.mkdirSync(dest, { recursive: true });
    }
    for (const child of fs.readdirSync(src)) {
      copyRecursive(path.join(src, child), path.join(dest, child));
    }
  } else {
    const destDir = path.dirname(dest);
    if (!fs.existsSync(destDir)) {
      fs.mkdirSync(destDir, { recursive: true });
    }
    fs.copyFileSync(src, dest);
    console.log(`  Copied: ${path.relative(path.join(__dirname, '..'), src)} → ${path.relative(path.join(__dirname, '..'), dest)}`);
  }
}

function main() {
  if (!fs.existsSync(PUBLIC_DIR)) {
    console.error(`Public directory not found: ${PUBLIC_DIR}`);
    process.exit(1);
  }

  if (!fs.existsSync(DOCS_DIR)) {
    fs.mkdirSync(DOCS_DIR, { recursive: true });
  }

  console.log('Building site: public/ → docs/\n');
  copyRecursive(PUBLIC_DIR, DOCS_DIR);

  // Write a .nojekyll file so GitHub Pages doesn't try to process the files
  const nojekyll = path.join(DOCS_DIR, '.nojekyll');
  if (!fs.existsSync(nojekyll)) {
    fs.writeFileSync(nojekyll, '');
    console.log('  Created: docs/.nojekyll');
  }

  console.log('\nSite build complete.');
  console.log(`Deployment folder: ${DOCS_DIR}`);
}

main();

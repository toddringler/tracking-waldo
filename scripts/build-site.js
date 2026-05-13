#!/usr/bin/env node
/**
 * Script 3: Site Build
 *
 * Finalizes /docs/ for GitHub Pages deployment.
 * Ensures docs exists and contains .nojekyll.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const DOCS_DIR = path.join(__dirname, '..', 'docs');

function main() {
  if (!fs.existsSync(DOCS_DIR)) {
    fs.mkdirSync(DOCS_DIR, { recursive: true });
  }

  console.log('Finalizing site in docs/\n');

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

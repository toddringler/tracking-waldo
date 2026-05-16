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
const EVENT_PHOTOS_SOURCE_DIR = path.join(__dirname, '..', 'data', 'events', 'photos');
const EVENT_PHOTOS_DEST_DIR = path.join(DOCS_DIR, 'events', 'photos');
const ORIGIN_STORY_SOURCE_FILE = path.join(__dirname, '..', 'background', 'Origin Story', 'waldo_origin_story.md');
const ORIGIN_STORY_DEST_FILE = path.join(DOCS_DIR, 'waldo-origin-story.md');
const ORIGIN_STORY_IMAGE_SOURCE_FILE = path.join(__dirname, '..', 'background', 'Origin Story', 'waldo.roams.png');
const ORIGIN_STORY_IMAGE_DEST_FILE = path.join(DOCS_DIR, 'background', 'waldo.roams.png');

function copyRecursive(src, dest) {
  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
    for (const entry of fs.readdirSync(src)) {
      copyRecursive(path.join(src, entry), path.join(dest, entry));
    }
    return;
  }

  const destDir = path.dirname(dest);
  if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
  fs.copyFileSync(src, dest);
}

function clearDirectoryContents(dirPath) {
  if (!fs.existsSync(dirPath)) return;
  for (const name of fs.readdirSync(dirPath)) {
    const entryPath = path.join(dirPath, name);
    fs.rmSync(entryPath, { recursive: true, force: true });
  }
}

function main() {
  if (!fs.existsSync(DOCS_DIR)) {
    fs.mkdirSync(DOCS_DIR, { recursive: true });
  }

  console.log('Finalizing site in docs/\n');

  // Sync optional event photos into docs so popup image links resolve.
  if (fs.existsSync(EVENT_PHOTOS_SOURCE_DIR)) {
    if (!fs.existsSync(EVENT_PHOTOS_DEST_DIR)) {
      fs.mkdirSync(EVENT_PHOTOS_DEST_DIR, { recursive: true });
    }
    clearDirectoryContents(EVENT_PHOTOS_DEST_DIR);
    copyRecursive(EVENT_PHOTOS_SOURCE_DIR, EVENT_PHOTOS_DEST_DIR);
    console.log('  Synced: data/events/photos → docs/events/photos');
  }

  // Publish origin story markdown for the in-page popup.
  if (fs.existsSync(ORIGIN_STORY_SOURCE_FILE)) {
    copyRecursive(ORIGIN_STORY_SOURCE_FILE, ORIGIN_STORY_DEST_FILE);
    console.log('  Synced: background/Origin Story/waldo_origin_story.md → docs/waldo-origin-story.md');
  }

  if (fs.existsSync(ORIGIN_STORY_IMAGE_SOURCE_FILE)) {
    copyRecursive(ORIGIN_STORY_IMAGE_SOURCE_FILE, ORIGIN_STORY_IMAGE_DEST_FILE);
    console.log('  Synced: background/Origin Story/waldo.roams.png → docs/background/waldo.roams.png');
  }

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

#!/usr/bin/env node
'use strict';

/**
 * Preflight para push: falla si .claspignore + rootDir no incluirían suficientes fuentes.
 * Exit 0 = OK; exit 1 = demasiado pocos archivos (regresión tipo "Pushed 1 file").
 */

const fs = require('fs');
const path = require('path');
const multimatch = require('multimatch');

const ROOT = path.resolve(__dirname, '..');
const MIN_FILES = Number(process.env.CLASP_PUSH_MIN_FILES || 10);
const EXPECTED_HINT = 26;

function walk(dir, base) {
  const out = [];
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, ent.name);
    const rel = path.relative(base, abs).split(path.sep).join('/');
    if (ent.isDirectory()) out.push(...walk(abs, base));
    else out.push(rel);
  }
  return out;
}

function listPushFiles() {
  const src = path.join(ROOT, 'src');
  const ignoreFile = path.join(ROOT, '.claspignore');
  const patterns = fs
    .readFileSync(ignoreFile, 'utf8')
    .split(/\r?\n/)
    .filter((name) => name.length > 0);
  const all = walk(src, src);
  return all.filter((rel) => multimatch([rel], patterns, { dot: true }).length === 0).sort();
}

function main() {
  const quiet = process.argv.includes('--quiet');
  const included = listPushFiles();
  const js = included.filter((f) => f.endsWith('.js'));
  const hasManifest = included.includes('appsscript.json');

  if (!quiet) {
    console.log(
      `Preflight push: ${included.length} archivos (js=${js.length}, appsscript.json=${hasManifest ? 1 : 0}; mínimo=${MIN_FILES}, típico≈${EXPECTED_HINT})`
    );
  }

  if (!hasManifest) {
    console.error('ABORT: falta appsscript.json en el set a pushear.');
    process.exit(1);
  }
  if (included.length < MIN_FILES) {
    console.error(
      `ABORT: solo ${included.length} archivo(s) pasarían el .claspignore (mínimo ${MIN_FILES}).`
    );
    console.error(
      'Con rootDir=src los paths son app/main.js (no src/app/main.js). Ver .claspignore y npm run clasp:files.'
    );
    process.exit(1);
  }
  if (!quiet) {
    console.log('Preflight OK');
  }
  return included;
}

if (require.main === module) {
  main();
}

module.exports = { listPushFiles, main, MIN_FILES };

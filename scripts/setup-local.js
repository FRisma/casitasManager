#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');

function ok(msg) {
  console.log(`✓ ${msg}`);
}
function warn(msg) {
  console.log(`! ${msg}`);
}

console.log('CasitasManager — setup local\n');

const node = process.version;
ok(`Node ${node}`);

const claspBin = path.join(ROOT, 'node_modules', '.bin', 'clasp');
if (fs.existsSync(claspBin)) {
  const v = spawnSync(claspBin, ['--version'], { encoding: 'utf8' });
  ok(`clasp ${(v.stdout || '').trim() || 'instalado'}`);
} else {
  warn('clasp no encontrado. Ejecutá: npm install');
}

const clasprc = path.join(process.env.HOME || '', '.clasprc.json');
if (fs.existsSync(clasprc)) {
  ok('clasp login detectado (~/.clasprc.json)');
} else {
  warn('Sin auth de clasp. Franco debe ejecutar: npm run clasp:login');
}

for (const env of ['dev', 'prod']) {
  const p = path.join(ROOT, `.clasp.${env}.json`);
  const cfg = JSON.parse(fs.readFileSync(p, 'utf8'));
  if (String(cfg.scriptId).includes('REPLACE_WITH_')) {
    warn(`.clasp.${env}.json aún tiene placeholder de Script ID`);
  } else {
    ok(`.clasp.${env}.json con Script ID`);
  }
}

console.log('\nSiguiente: ver docs/SETUP.md');
console.log('Tras clasp login + crear proyectos DEV/PROD, completar Script IDs y:');
console.log('  npm run push:dev');
console.log('En el editor Apps Script (DEV): ejecutar setupEnvironment()');

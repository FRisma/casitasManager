#!/usr/bin/env node
'use strict';

/**
 * Safe clasp wrapper: copies .clasp.{env}.json → .clasp.json then runs clasp.
 * push:dev / pull:dev never use the PROD scriptId.
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const PLACEHOLDER = 'REPLACE_WITH_';

function usage() {
  console.error('Uso: node scripts/safe-clasp.js <push|pull|deploy|status> <dev|prod>');
  process.exit(1);
}

function loadEnvConfig(env) {
  const src = path.join(ROOT, `.clasp.${env}.json`);
  if (!fs.existsSync(src)) {
    console.error(`No existe ${src}`);
    process.exit(1);
  }
  const cfg = JSON.parse(fs.readFileSync(src, 'utf8'));
  if (!cfg.scriptId || String(cfg.scriptId).includes(PLACEHOLDER)) {
    console.error(
      `[${env}] scriptId pendiente. Creá el proyecto Apps Script, copiá el Script ID a .clasp.${env}.json y reintentá.`
    );
    console.error('Ver docs/SETUP.md → sección clasp.');
    process.exit(2);
  }
  if (env === 'dev' && cfg.scriptId === readScriptId('prod')) {
    console.error('ABORT: el Script ID de DEV coincide con PROD. Separación obligatoria.');
    process.exit(3);
  }
  return { src, cfg };
}

function readScriptId(env) {
  try {
    const p = path.join(ROOT, `.clasp.${env}.json`);
    if (!fs.existsSync(p)) return null;
    return JSON.parse(fs.readFileSync(p, 'utf8')).scriptId || null;
  } catch (_) {
    return null;
  }
}

function activate(env) {
  const { src, cfg } = loadEnvConfig(env);
  const dest = path.join(ROOT, '.clasp.json');
  fs.copyFileSync(src, dest);
  console.log(`Activo: ${env} (scriptId …${String(cfg.scriptId).slice(-8)})`);
  return cfg;
}

function runClasp(args) {
  const localClasp = path.join(ROOT, 'node_modules', '.bin', 'clasp');
  const bin = fs.existsSync(localClasp) ? localClasp : 'clasp';
  const result = spawnSync(bin, args, { cwd: ROOT, stdio: 'inherit', shell: false });
  process.exit(result.status == null ? 1 : result.status);
}

const [, , action, env] = process.argv;
if (!action) usage();

if (action === 'status') {
  for (const e of ['dev', 'prod']) {
    const id = readScriptId(e);
    const ready = id && !String(id).includes(PLACEHOLDER);
    console.log(`${e}: ${ready ? 'configurado (' + id.slice(-8) + ')' : 'PENDIENTE (placeholder)'}`);
  }
  const active = path.join(ROOT, '.clasp.json');
  console.log(`.clasp.json: ${fs.existsSync(active) ? 'presente (local, no versionado)' : 'ausente'}`);
  process.exit(0);
}

if (!env || !['dev', 'prod'].includes(env)) usage();

if (action === 'deploy' && env === 'prod') {
  console.error('deploy:prod requiere confirmación explícita de Franco.');
  console.error('Si ya tenés aprobación, usá: CONFIRM_PROD=yes npm run deploy:prod');
  if (process.env.CONFIRM_PROD !== 'yes') process.exit(4);
}

activate(env);

if (action === 'push') {
  // Evita el regreso "Pushed 1 file" por .claspignore mal alineado con rootDir=src
  const pre = spawnSync(process.execPath, [path.join(__dirname, 'clasp-push-preflight.js')], {
    cwd: ROOT,
    stdio: 'inherit',
  });
  if (pre.status !== 0) process.exit(pre.status == null ? 1 : pre.status);
}

const claspArgs =
  action === 'push'
    ? ['push', '-f']
    : action === 'pull'
      ? ['pull']
      : action === 'deploy'
        ? ['deploy']
        : null;

if (!claspArgs) usage();
runClasp(claspArgs);

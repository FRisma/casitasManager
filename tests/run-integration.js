#!/usr/bin/env node
'use strict';

/**
 * Integration checks locales (sin Google auth).
 * Verifica estructura, build y probes HTTP de portales cuando la red lo permite.
 */

const path = require('path');
const { spawnSync } = require('child_process');
const https = require('https');
const http = require('http');

const ROOT = path.join(__dirname, '..');

function run(cmd, args) {
  const r = spawnSync(cmd, args, { cwd: ROOT, encoding: 'utf8' });
  return r;
}

console.log('== build ==');
let r = run('node', ['scripts/build.js']);
process.stdout.write(r.stdout || '');
process.stderr.write(r.stderr || '');
if (r.status !== 0) process.exit(r.status);

console.log('\n== unit ==');
r = run('node', ['tests/run-unit.js']);
process.stdout.write(r.stdout || '');
process.stderr.write(r.stderr || '');
if (r.status !== 0) process.exit(r.status);

function probe(url) {
  return new Promise(function (resolve) {
    const lib = url.startsWith('https') ? https : http;
    const req = lib.get(url, { timeout: 15000, headers: { 'User-Agent': 'CasitasManager-probe' } }, function (res) {
      let data = '';
      res.on('data', function (c) {
        data += c;
        if (data.length > 8000) req.destroy();
      });
      res.on('end', function () {
        resolve({ url: url, code: res.statusCode, sample: data.slice(0, 120).replace(/\s+/g, ' ') });
      });
    });
    req.on('error', function (e) {
      resolve({ url: url, code: 0, error: e.message });
    });
  });
}

(async function () {
  console.log('\n== portal probes (best-effort) ==');
  const urls = [
    'https://autogestion.ecogas.com.ar/uiextranet/ingreso?s=p',
    'https://oficinavirtual.naturgysj.com.ar/publico/pagos/consulta',
    'http://181.209.107.110:83/deudavencida/deuda_total.aspx',
    'https://facturaweb.osse.ar/',
  ];
  for (const u of urls) {
    const p = await probe(u);
    console.log(JSON.stringify(p));
  }
  console.log('\nIntegration local OK (E2E Google Drive/Sheets/Gmail bloqueado sin auth Franco).');
})();

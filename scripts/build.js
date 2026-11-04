#!/usr/bin/env node
'use strict';

/**
 * Verifica que el árbol src/ esté listo para clasp push.
 * No hay bundler: Apps Script consume los .js directamente.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'src');

const REQUIRED = [
  'appsscript.json',
  'app/main.js',
  'app/scheduler.js',
  'app/setup.js',
  'config/services.js',
  'config/settings.js',
  'providers/provider-interface.js',
  'providers/naturgy.js',
  'providers/osse.js',
  'providers/ecogas.js',
  'providers/municipalidad.js',
  'services/drive.js',
  'services/sheets.js',
  'services/invoices.js',
  'services/payments.js',
  'services/notifications.js',
  'services/email.js',
  'services/telegram.js',
  'utils/dates.js',
  'utils/hashes.js',
  'utils/logging.js',
  'utils/pdf.js',
];

let missing = 0;
for (const rel of REQUIRED) {
  const p = path.join(SRC, rel);
  if (!fs.existsSync(p)) {
    console.error(`Falta: src/${rel}`);
    missing++;
  }
}

if (missing) {
  console.error(`build falló: ${missing} archivo(s) faltante(s)`);
  process.exit(1);
}

console.log(`build OK — ${REQUIRED.length} archivos src/ verificados (sin bundler)`);

#!/usr/bin/env node
'use strict';

/** Wrapper legible: lista archivos + corre preflight (mínimo 10). */
const { listPushFiles, main } = require('./clasp-push-preflight');

const included = listPushFiles();
console.log('rootDir: src (paths relative a src/)\n');
console.log(`Incluidos para push (${included.length}):`);
included.forEach((f) => console.log('  +', f));
console.log('');
main();

'use strict';

// Node's built-in coverage collector is deterministic within one test process,
// but its experimental cross-process range merge can drop covered ranges. Keep
// the normal suite split by file for readable failures; coverage loads those
// same files into this single process in a stable order.
const fs = require('node:fs');
const path = require('node:path');

for (const file of fs.readdirSync(__dirname).filter((name) => name.endsWith('.test.js')).sort()) {
  require(path.join(__dirname, file));
}

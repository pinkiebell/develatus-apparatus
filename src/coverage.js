'use strict';

import fs from 'fs';
import { resolve as resolvePath } from 'path';

export default function computeCoverage (artifacts, config) {
  const json = {
    coverage: {
    },
  };
  const contracts = artifacts.artifacts;
  // http://ltp.sourceforge.net/coverage/lcov/geninfo.1.php
  let lcov = '';

  for (let i = 0; i < contracts.length; i++) {
    const contract = contracts[i];
    let path = contract.filePath;

    if (!fs.existsSync(path)) {
      const maybeMatch = 'node_modules/' + path;

      if (fs.existsSync(path)) {
        path = maybeMatch;
      }
    }

    if (config.ignore && path.match(config.ignore)) {
      process.stdout.write(`ignoring ${path}\n`);
      continue;
    }

    const cover = {};
    let hits = 0;
    let miss = 0;

    lcov += `SF:${path}\n`;
    for (let key in contract.lineMap) {
      const val = contract.lineMap[key];
      const ignore = (val.hit === 0 && val.miss === 0);
      const green = (val.hit > 0);

      if (green) {
        if (!cover[val.line]) {
          if (cover[val.line] === 0) {
            miss -= 1;
          }
          cover[val.line] = 1;
          hits += 1;
          lcov += `DA:${val.line},${val.hit}\n`;
        }
      } else if (ignore) {
        // ignoring for now
      } else {
        if (cover[val.line] === undefined) {
          cover[val.line] = 0;
          lcov += `DA:${val.line},0\n`;
          miss += 1;
        }
      }
    }
    json.coverage[path] = cover;
    lcov += `LH:${hits}\nLF:${hits + miss}\nend_of_record\n`;

    const totalLines = contract.numberOfLines;
    const covered = ((totalLines - miss) / totalLines) * 100;

    process.stdout.write(
      `Coverage for ${contract.name}:\n` +
      `  hits: ${hits}\n` +
      `  miss: ${miss}\n` +
      `  total lines: ${totalLines}\n` +
      `  coverage: ${covered.toPrecision(4)}\n`
    );
  }

  return { json, lcov };
}

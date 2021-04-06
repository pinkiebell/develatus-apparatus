'use strict';

import fs from 'fs';
import { resolve as resolvePath } from 'path';
import { spawn } from 'child_process';

import ArtifactProxy from './ArtifactProxy.js';

function onException (e) {
  process.stderr.write(`${e.stack || e}\n`);
  process.exit(1);
}

function computeCoverage (artifacts, config) {
  const coverage = {
    coverage: {
    },
  };
  const contracts = artifacts.artifacts;
  // http://ltp.sourceforge.net/coverage/lcov/geninfo.1.php
  let lcov = '';

  for (let i = 0; i < contracts.length; i++) {
    const contract = contracts[i];

    if (config.ignore && contract.fileName.match(config.ignore)) {
      process.stdout.write(`ignoring ${contract.fileName}\n`);
      continue;
    }

    const cover = {};
    let hits = 0;
    let miss = 0;
    let path = contract.fileName;

    if (!fs.existsSync(path)) {
      path = 'node_modules/' + path;
    }
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
    coverage.coverage[contract.fileName] = cover;
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

  const path = resolvePath('./coverage-report.json');
  const lcovPath = resolvePath('./coverage-report.lcov');

  fs.writeFileSync(path, JSON.stringify(coverage));
  fs.writeFileSync(lcovPath, lcov);
  process.stdout.write(`Written to ${path}, ${lcovPath}\n`);
}

(async function () {
  process.on('uncaughtException', onException);
  process.on('unhandledRejection', onException);

  const config = (await import(resolvePath('.develatus-apparatus.js'))).default;
  const path = resolvePath(config.artifactsPath);
  const artifacts = new ArtifactProxy(config);
  const files = fs.readdirSync(path);

  // XXX: we don't expect directories here, just json build artifacts.
  while (files.length) {
    const file = files.pop();
    const artifact = JSON.parse(fs.readFileSync(resolvePath(`${path}/${file}`)));

    artifacts.add(artifact);
  }

  await artifacts.prepare();

  const exitCode = await new Promise(
    function (resolve, reject) {
      const opts = { shell: true, stdio: ['inherit', 'inherit', 'inherit'] };
      const proc = spawn(config.testCommand, opts);

      proc.on('exit', function (exitCode) {
        resolve(exitCode);
      });
    }
  );

  await artifacts.finish();
  computeCoverage(artifacts, config);
  process.exit(exitCode);
})();

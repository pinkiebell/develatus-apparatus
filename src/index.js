'use strict';

import fs from 'fs';
import { resolve as resolvePath } from 'path';
import { spawn } from 'child_process';

import ArtifactProxy from './ArtifactProxy.js';

function onException (e) {
  process.stderr.write(`${e.stack || e}\n`);
  process.exit(1);
}

function computeCoverage (artifacts) {
  const coverage = {
    coverage: {
    },
  };
  const contracts = artifacts.artifacts;

  for (let i = 0; i < contracts.length; i++) {
    const contract = contracts[i];
    const cover = {};
    let hits = 0;
    let miss = 0;

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
        }
      } else if (ignore) {
        // ignoring for now
      } else {
        if (cover[val.line] === undefined) {
          cover[val.line] = 0;
          miss += 1;
        }
      }
    }
    coverage.coverage[contract.fileName] = cover;

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

  fs.writeFileSync(path, JSON.stringify(coverage));
  process.stdout.write(`Written to ${path}\n`);
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
  computeCoverage(artifacts);
  process.exit(exitCode);
})();

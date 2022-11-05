'use strict';

import fs from 'fs';
import { resolve as resolvePath } from 'path';
import { spawn } from 'child_process';

import ArtifactProxy from './ArtifactProxy.js';
import computeCoverage from './coverage.js';

function onException (e) {
  process.stderr.write(`${e.stack || e}\n`);
  process.exit(1);
}

function onSignal () {
  process.exit(0);
}

(async function () {
  process.on('uncaughtException', onException);
  process.on('unhandledRejection', onException);
  process.on('SIGINT', onSignal);
  process.on('SIGTERM', onSignal);

  const config = (await import(resolvePath('.develatus-apparatus.mjs'))).default;
  const artifacts = new ArtifactProxy(config);

  if (config.testCommand) {
    await artifacts.reload();

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
    const { json, lcov } = computeCoverage(artifacts, config);
    const path = resolvePath('./coverage-report.json');
    const lcovPath = resolvePath('./coverage-report.lcov');

    fs.writeFileSync(path, JSON.stringify(json));
    fs.writeFileSync(lcovPath, lcov);
    process.stdout.write(`Written to ${path}, ${lcovPath}\n`);
    process.exit(exitCode);
  }
})();

#!/usr/bin/env node

import fs from 'fs';
import { createHash } from 'crypto';
import { resolve as resolvePath } from 'path';

const DEFAULT_SETTINGS = {
  evmVersion: 'istanbul',
  outputSelection: {
    '*': {
      '': [
        'ast',
      ],
      '*': [
        'abi',
        'metadata',
        'evm.bytecode.object',
        'evm.bytecode.sourceMap',
        'evm.deployedBytecode.object',
        'evm.deployedBytecode.sourceMap',
        'userdoc',
        'devdoc',
      ],
    },
  },
};

const config = (await import(resolvePath('.develatus-apparatus.js'))).default;
const solcSettings = Object.assign(DEFAULT_SETTINGS, config.solcSettings || {});
const sources = {};
let outputDir = '';

for (const dir of ['build/', 'contracts']) {
  outputDir += dir;
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir);
  }
}

for (let i = 2; i < process.argv.length; i++) {
  const path = process.argv[i];
  const source = fs.readFileSync(path).toString();

  sources[path] = { content: source };
  process.stdout.write(`> Compiling ${path}\n`);
}

const language = 'Solidity';
const compilerInput = {
  language,
  sources,
  settings: solcSettings,
};
const standardJson = JSON.stringify(compilerInput);
const hashBuf = createHash('sha256').update(standardJson).digest();
const hashFile = 'build/.hash';
try {
  const buf = fs.readFileSync(hashFile);

  if (buf.equals(hashBuf)) {
    process.stdout.write('No changes. Not compiling\n');
    process.exit(0);
  }
} catch (e) {
  // ignore
}

function importCallback (path) {
  let realPath = path;

  if (!fs.existsSync(realPath)) {
    // try node_modules
    realPath = `node_modules/${realPath}`;
  }

  const source = fs.readFileSync(realPath).toString();

  sources[path] = { content: source };

  return { contents: source };
}

const solc = (await import('solc')).default;
const output = JSON.parse(solc.compile(standardJson, { import: importCallback }));

if (output.errors) {
  for (const obj of output.errors) {
    process.stderr.write(obj.formattedMessage);
  }
}

if (!output.contracts) {
  if (fs.existsSync(hashFile)) {
    fs.unlinkSync(hashFile);
  }
  process.exit(1);
}

for (const file in output.contracts) {
  const contract = output.contracts[file];
  const sourceObj = output.sources[file];
  const source = sources[file].content;

  for (const contractName in contract) {
    const obj = contract[contractName];

    obj.id = sourceObj.id;
    obj.ast = sourceObj.ast;
    obj.legacyAST = sourceObj.legacyAST;
    obj.source = source;

    const evm = obj.evm;
    delete obj.evm;

    obj.contractName = contractName;
    obj.bytecode = `0x${evm.bytecode.object}`;
    obj.sourceMap = evm.bytecode.sourceMap;
    obj.deployedBytecode = `0x${evm.deployedBytecode.object}`;
    obj.deployedSourceMap = evm.deployedBytecode.sourceMap;

    const artifactPath = `${outputDir}/${contractName}.json`;

    fs.writeFileSync(artifactPath, JSON.stringify(obj, null, 2));
    process.stdout.write(`> Artifact for ${contractName} written to ${artifactPath}\n`);

    {
      const meta = JSON.parse(obj.metadata);
      const inputSources = {};
      for (const file in meta.sources) {
        inputSources[file] = sources[file];
      }
      const compilerInput = {
        language: meta.language,
        settings: meta.settings,
        sources: inputSources,
      };
      const solcInputPath = `./build/solc-input-${contractName}.json`;
      fs.writeFileSync(solcInputPath, JSON.stringify(compilerInput, null, 2));
      process.stdout.write(`> Written compiler input to ${solcInputPath}\n`);
    }
  }
}

fs.writeFileSync(hashFile, hashBuf);
process.stdout.write(`> Compiled successfully using solc ${solc.version()}\n`);

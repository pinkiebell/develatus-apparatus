'use strict';

module.exports = class Artifacts {
  constructor () {
    this.artifacts = [];
    this.contractByFileId = {};
  }

  add (artifact) {
    const obj = {};

    obj.visitedLocations = {};
    obj.name = artifact.contractName;
    obj.deployedBytecode = artifact.deployedBytecode;
    obj.bytecode = Buffer.from(obj.deployedBytecode.replace('0x', ''), 'hex');
    obj.deployedSourceMap = artifact.deployedSourceMap;
    obj.ast = artifact.ast;
    obj.source = artifact.source;
    obj.nodes = {};
    obj.fileName = artifact.ast.absolutePath;
    obj.fileId = obj.ast.src.split(':')[2];

    this.makeLineMap(obj);
    this.parseAst(obj);

    this.contractByFileId[obj.fileId] = obj;
    this.artifacts.push(obj);
  }

  async prepare () {
    let len = this.artifacts.length;

    while (len--) {
      await this.parseSourceMap(this.artifacts[len]);
    }
  }

  makeLineMap (obj) {
    const source = obj.source.split('');
    const len = source.length;
    const lineMap = [];
    let line = 1;
    let column = 0;

    for (let i = 0; i < len; i++) {
      const char = source[i];

      if (char === '\n') {
        line += 1;
        column -= 1;

        lineMap.push(
          {
            line: line,
            column: 0,
            hit: 0,
            miss: 0,
          }
        );
      } else {
        lineMap.push(
          {
            line: line,
            column: column,
            hit: 0,
            miss: 0,
          }
        );

        column += 1;
      }
    }

    obj.numberOfLines = line - 1;
    obj.lineMap = lineMap;
  }

  parseAst (obj) {
    // TODO: kind of hacky at the moment.
    // Do it properly 🙃
    let nodes = [].concat(obj.ast.nodes);
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];

      if (!node.src) {
        continue;
      }
      // TODO: handle this
      // if (obj.nodes[node.src]) {
      // }

      obj.nodes[node.src] = node;

      for (const k in node) {
        const f = node[k];

        if (Array.isArray(f)) {
          nodes = nodes.concat(f);
        } else {
          if (f) {
            nodes.push(f);
          }
        }
      }
    }
  }

  parseSourceMap (obj) {
    const map = obj.deployedSourceMap.split(';');

    process.stdout.write(
      `Processing: ${obj.name}\n` +
      `  Number of source map entries: ${map.length}\n` +
      `  Bytecode length: ${obj.bytecode.length}\n`
    );

    if (obj.bytecode.length === 0) {
      obj.sourceMap = [];
      return [];
    }

    const len = map.length;
    const sourceMap = [];
    let pc = 0;
    let last = {
      start: 0,
      length: 0,
      file: -1,
      jump: '-',
      opcode: -1,
    };

    for (let i = 0; i < len; i++) {
      const current = map[i].split(':');
      const ret = {
        start: last.start,
        length: last.length,
        file: last.file,
        jump: last.jump,
        opcode: last.opcode,
      };

      if (current[0] && current[0] !== '-1' && current[0].length) {
        ret.start = parseInt(current[0]);
      }

      if (current[1] && current[1] !== '-1' && current[1].length) {
        ret.length = parseInt(current[1]);
      }

      if (current[2] && current[2].length) {
        ret.file = parseInt(current[2]);
      }
      if (current[3] && current[3].length) {
        ret.jump = current[3];
      }

      ret.opcode = obj.bytecode[pc].toString(16).padStart(2, '0');
      ret.nodeId = `${ret.start}:${ret.length}:${ret.file}`;

      // TODO: find a much better way to filter nodes 🙈
      let skip = true;
      const contract = this.contractByFileId[ret.file];

      if (contract) {
        const node = contract.nodes[ret.nodeId];
        if (
          node &&
          node.nodeType !== 'ContractDefinition' &&
          node.nodeType !== 'FunctionDefinition' &&
          node.nodeType !== 'WhileStatement' &&
          node.nodeType !== 'ForStatement' &&
          !node.trueBody &&
          !node.falseBody &&
          ret.jump === '-'
        ) {
          skip = false;

          // let source = obj.source;
          // if (obj.fileId !== ret.file) {
          //  source = this.contractByFileId[ret.file].source;
          //}
          // source = source.substring(ret.start, ret.start + ret.length);
        }
      }

      if (skip) {
        sourceMap[pc] = null;
      } else {
        sourceMap[pc] = ret;
      }

      let opcode = obj.bytecode[pc];
      if (opcode >= 0x60 && opcode <= 0x7f) {
        const numToPush = obj.bytecode[pc] - 0x5f;
        pc += numToPush;
      }
      pc++;
      last = ret;
    }

    obj.sourceMap = sourceMap;
  }

  markLocation (obj, pc) {
    obj.visitedLocations[pc] = true;

    const sourceMap = obj.sourceMap[pc];
    if (sourceMap) {
      sourceMap.visited = true;
    }
  }

  finalize () {
    let len = this.artifacts.length;

    while (len--) {
      const artifact = this.artifacts[len];
      let mapLen = artifact.sourceMap.length;

      while (mapLen--) {
        let sourceMap = artifact.sourceMap[mapLen];
        if (!sourceMap) {
          continue;
        }

        const contract = this.contractByFileId[sourceMap.file];
        if (!contract) {
          continue;
        }

        const start = sourceMap.start;
        const end = start + sourceMap.length;

        for (let x = start; x < end; x++) {
          const obj = contract.lineMap[x];

          if (sourceMap.visited) {
            obj.hit = 1;
          } else {
            obj.miss = 1;
          }
        }
      }
    }
  }
};

'use strict';

import http from 'http';
import https from 'https';
import { parse as urlParse } from 'url';

import Artifacts from './Artifacts.js';
import computeCoverage from './coverage.js';

const TRACER = {
  timeout: '1200s',
  tracer:
`
{
   data: [],
   fault: function() {
   },
   step: function(log, db) {
     var pc = log.getPC();
     var depth = log.getDepth();
     var obj = { pc };
     var op = log.op.toNumber();
     if (op === 0xf1 || op === 0xf2 || op === 0xf4 || op === 0xfa) {
       this.target = toAddress(log.stack.peek(1).toString(16));
     }
     if (depth !== this.depth) {
       this.depth = depth;
       obj.depth = depth;
       obj.target = toHex(this.target || log.contract.getAddress());
       obj.code = toHex(db.getCode(this.target || log.contract.getAddress()));
     }

     this.data.push(obj);
   },
   result: function() { return this.data; }
}`,
};

export default class ArtifactProxy extends Artifacts {
  constructor (options) {
    super(options);

    this.fuzzyMatchFactor = options.fuzzyMatchFactor || 0.7;
    this.jobs = [];
    this.logged = {};

    this.fetchOptions = urlParse(options.rpcUrl);
    this.fetchOptions.method = 'POST';
    this.fetchOptions.headers = { 'Content-Type': 'application/json' };

    const server = new http.Server(this.onRequest.bind(this));
    //server.timeout = 90000;
    server.keepAliveTimeout = 0;
    server.listen(options.proxyPort);
    setInterval(this.dutyCycle.bind(this), 30);
  }

  async dutyCycle () {
    const job = this.jobs.shift();
    if (job) {
      await this.doTrace(...job);
    }
  }

  async onRequest (req, resp) {
    const self = this;

    if (req.method === 'POST') {
      let body = Buffer.alloc(0);
      req.on('data', function (buf) {
        body = Buffer.concat([body, buf]);
      });
      req.on('end', function () {
        self.onPost(req, resp, JSON.parse(body.toString()));
      });
      return;
    }

    if (req.method === 'GET') {
      if (req.url === '/reload') {
        await this.reload();
        resp.end();
        return;
      }
      if (req.url === '/.json') {
        await this.finish();
        const { json } = computeCoverage(this, this.config);
        resp.end(JSON.stringify(json));
        return;
      }
      if (req.url === '/.lcov') {
        await this.finish();
        const { lcov } = computeCoverage(this, this.config);
        resp.end(lcov);
        return;
      }

      resp.statusCode = 404;
      resp.end();
      return;
    }
  }

  async onPost (req, resp, body) {
    resp.setHeader('content-type', 'application/json');
    const method = body.method;

    if (
      method === 'eth_sendRawTransaction'
      || method === 'eth_sendTransaction'
      || method === 'eth_call'
      || method === 'eth_estimateGas'
      || method === 'debug_traceCall'
    ) {
      const res = await this.fetch(body);
      let txHashOrCallObject;
      if (method === 'eth_estimateGas' || method === 'eth_call' || method === 'debug_traceCall') {
        txHashOrCallObject = body.params;
        let blockTag = txHashOrCallObject[1] || 'latest';
        if (Number.isNaN(Number(blockTag))) {
          // keep a correct 'anchor' of the block to trace against
          const obj = await this.fetch(
            {
              jsonrpc: '2.0',
              id: 42,
              method: 'eth_getHeaderByNumber',
              params: [blockTag],
            }
          );

          if (obj && obj.result) {
            blockTag = obj.result.number;
          }
        }
        txHashOrCallObject[1] = blockTag;
      } else {
        txHashOrCallObject = res.result;
      }

      if (txHashOrCallObject) {
        this.jobs.push([method, txHashOrCallObject]);
      }

      resp.end(JSON.stringify(res));
      return;
    }

    const res = await this.fetch(body);
    resp.end(JSON.stringify(res));
  }

  async fetch (obj) {
    const self = this;

    return new Promise(
      function (resolve, reject) {
        const proto = self.fetchOptions.protocol === 'http:' ? http : https;
        const req = proto.request(self.fetchOptions);
        let body = Buffer.alloc(0);

        req.on('error', reject);
        req.on('response', function (resp) {
          resp.on('data', function (buf) {
            body = Buffer.concat([body, buf]);
          });
          resp.on('end', function () {
            resolve(JSON.parse(body.toString()));
          });
        });

        req.end(JSON.stringify(obj));
      }
    );
  }

  async findContract (code, to) {
    let contract;
    let len = this.artifacts.length;
    while (len--) {
      const tmp = this.artifacts[len];
      if (tmp.deployedBytecode === code) {
        contract = tmp;
        break;
      }
    }

    if (!contract) {
      len = this.artifacts.length;
      let bestMatch = 0;

      while (len--) {
        // try to fuzzy-match the bytecode
        // some projects modify the bytecode
        const tmp = this.artifacts[len];
        const codeLen =
          tmp.deployedBytecode.length > code.length ? code.length : tmp.deployedBytecode.length;
        let matches = 0;

        for (let i = 2; i < codeLen; i++) {
          if (code[i] === tmp.deployedBytecode[i]) {
            matches++;
          }
        }

        if (matches >= (codeLen * this.fuzzyMatchFactor) && matches > bestMatch) {
          bestMatch = matches;
          contract = tmp;
        }
      }

      if (contract) {
        this.logOnce(
          `***develatus-apparatus: (Warning) Fuzzy-matched contract at ${to} as ${contract.name}***\n`
        );
      } else {
        this.logOnce(
          `***develatus-apparatus: (Warning) No artifact found for contract at ${to}***\n`
        );
      }
    }

    return contract;
  }

  // https://github.com/ethereum/go-ethereum/blob/master/eth/tracers/internal/tracers/call_tracer.js
  async doTrace (method, txHashOrCallObject) {
    if (!txHashOrCallObject) {
      return;
    }

    let trace;
    if (typeof txHashOrCallObject === 'string') {
      for (let i = 0; i < 3000; i++) {
        const obj = await this.fetch(
          {
            jsonrpc: '2.0',
            id: 42,
            method: 'eth_getTransactionReceipt',
            params: [txHashOrCallObject],
          }
        );

        if (obj.result) {
          break;
        }

        await new Promise(function (resolve) { setTimeout(resolve, 30 ); });
      }

      trace = await this.fetch(
        {
          jsonrpc: '2.0',
          id: 42,
          method: 'debug_traceTransaction',
          params: [txHashOrCallObject, TRACER],
        }
      );
    } else {
      let params = [...txHashOrCallObject];
      if (params.length < 2) {
        params.push('latest');
      }
      if (params.length > 2) {
        const tracerConfig = Object.assign({}, TRACER);
        const opt = params[2];
        if (typeof opt === 'object') {
          if (opt.stateOverrides || opt.blockOverrides) {
            tracerConfig.stateOverrides = opt.stateOverrides || {};
            tracerConfig.blockOverrides = opt.blockOverrides || {};
          } else {
            tracerConfig.stateOverrides = opt;
          }
        }
        params = [params[0], params[1], tracerConfig];
      } else {
        params = [params[0], params[1], TRACER];
      }
      trace = await this.fetch(
        {
          jsonrpc: '2.0',
          id: 42,
          method: 'debug_traceCall',
          params,
        }
      );
    }

    if (!trace.result) {
      process.stderr.write(
        `***\ndevelatus-apparatus: Error getting trace\n${JSON.stringify({ method, txHashOrCallObject, trace }, null, 2)}\n***\n`
      );
      return;
    }

    const logs = trace.result;
    const len = logs.length;
    let to;
    let code;
    for (let i = 0; i < len; i++) {
      const log = logs[i];
      const pc = log.pc;
      to = log.target || to;
      code = log.code || code;
      const contract = await this.findContract(code, to);
      if (contract) {
        this.markLocation(contract, pc);

        const op = contract.bytecode[pc];
        if (op >= 0x60 && op <= 0x7f) {
          const numToPush = op - 0x5f;
          for (let x = 1; x <= numToPush; x++) {
            this.markLocation(contract, pc + x);
          }
        }
      }
    }
  }

  async finish () {
    while (true) {
      if (this.jobs.length === 0) {
        break;
      }
      await new Promise(
        function (resolve) {
          setTimeout(resolve, 100);
        }
      );
    }

    this.finalize();
  }

  logOnce (str) {
    if (!this.logged[str]) {
      process.stderr.write(str);
      this.logged[str] = true;
    }
  }
};

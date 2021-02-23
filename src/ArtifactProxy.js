'use strict';

import http from 'http';
import https from 'https';
import { parse as urlParse } from 'url';

import Artifacts from './Artifacts.js';

const TRACER = {
  timeout: '1200s',
  tracer:
`
{
   data: [],
   fault: function() {
   },
   step: function(log) {
     var pc = log.getPC();
     var depth = log.getDepth();
     var obj = { pc }

     if (depth !== this.depth) {
       this.depth = depth;
       obj.depth = depth;
       obj.target = toHex(log.contract.getAddress());
     }

     this.data.push(obj);
   },
   result: function() { return this.data; }
}`,
};

export default class ArtifactProxy extends Artifacts {
  constructor (options) {
    super();

    this.fuzzyMatchFactor = options.fuzzyMatchFactor || 0.7;
    this.addrToContract = {};
    this.pendingTraces = 0;

    this.fetchOptions = urlParse(options.rpcUrl);
    this.fetchOptions.method = 'POST';
    this.fetchOptions.headers = { 'Content-Type': 'application/json' };

    const server = new http.Server(this.onRequest.bind(this));
    //server.timeout = 90000;
    server.listen(options.proxyPort, 'localhost');
  }

  onRequest (req, res) {
    let body = Buffer.alloc(0);
    const self = this;

    if (req.method === 'POST') {
      req.on('data', function (buf) {
        body = Buffer.concat([body, buf]);
      });
      req.on('end', function () {
        self.onPost(req, res, JSON.parse(body.toString()));
      });
    }
  }

  async onPost (req, resp, body) {
    const method = body.method;

    if (method === 'eth_sendRawTransaction' || method === 'eth_sendTransaction' || method === 'eth_call') {
      const res = await this.fetch(body);
      const txHashOrCallObject = method === 'eth_call' ? body.params : res.result;

      if (txHashOrCallObject) {
        // TODO
        // this was initially done in async.
        // but this might kill the node for many and long running traces.
        // Either use a priority queue (because of state pruning (128 blocks), we might not be able to trace a tx)
        // or just simply block ;)
        await this.doTraceWrapper(txHashOrCallObject);
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

  async findContract (receipt) {
    let to = receipt.to || receipt.contractAddress;

    if (!to) {
      return;
    }

    to = to.toLowerCase();
    let contract = this.addrToContract[to];

    if (contract) {
      return contract;
    }

    const code = await this.fetch({ jsonrpc: '2.0', id: 42, method: 'eth_getCode', params: [to, 'latest'] });

    if (!code.result || code.result === '0x') {
      return;
    }

    let len = this.artifacts.length;
    while (len--) {
      const tmp = this.artifacts[len];
      if (tmp.deployedBytecode === code.result) {
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
          tmp.deployedBytecode.length > code.result.length ? code.result.length : tmp.deployedBytecode.length;
        let matches = 0;

        for (let i = 2; i < codeLen; i++) {
          if (code.result[i] === tmp.deployedBytecode[i]) {
            matches++;
          }
        }

        if (matches >= (codeLen * this.fuzzyMatchFactor) && matches > bestMatch) {
          bestMatch = matches;
          contract = tmp;
        }
      }

      if (contract) {
        process.stderr.write(
          `***develatus-apparatus: (Warning) Fuzzy-matched contract at ${to} as ${contract.name}***\n`
        );
      } else {
        process.stderr.write(
          `***develatus-apparatus: (Warning) No artifact found for contract at ${to}***\n`
        );
      }
    }

    if (contract) {
      this.addrToContract[to] = contract;
    }
    return contract;
  }

  // https://github.com/ethereum/go-ethereum/blob/master/eth/tracers/internal/tracers/call_tracer.js
  async doTrace (txHashOrCallObject) {
    if (!txHashOrCallObject) {
      return;
    }

    let receipt;
    let trace;

    if (typeof txHashOrCallObject === 'string') {
      for (let i = 0; i < 100; i++) {
        const obj = await this.fetch(
          {
            jsonrpc: '2.0',
            id: 42,
            method: 'eth_getTransactionReceipt',
            params: [txHashOrCallObject],
          }
        );

        if (obj.result) {
          receipt = obj.result;
          break;
        }

        await new Promise(function (resolve) { setTimeout(resolve, 30 ); });
      }

      if (!receipt.to) {
        // ignoring deployment
        return;
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
      receipt = txHashOrCallObject[0];
      trace = await this.fetch(
        {
          jsonrpc: '2.0',
          id: 42,
          method: 'debug_traceCall',
          params: [...txHashOrCallObject, TRACER],
        }
      );
    }

    if (!trace.result) {
      process.stderr.write(
        `***\ndevelatus-apparatus: Error getting trace\n${JSON.stringify({ trace, receipt }, null, 2)}\n***\n`
      );
      return;
    }

    const logs = trace.result;
    const len = logs.length;
    const contracts = [null, await this.findContract(receipt)];
    let currentDepth = 1;

    for (let i = 0; i < len; i++) {
      const log = logs[i];
      const pc = log.pc;
      const depth = log.depth || currentDepth;

      let contract = contracts[depth];

      if (depth !== currentDepth) {
        if (depth >= contracts.length) {
          contract = await this.findContract({ to: log.target });
          contracts[depth] = contract;
        }
        currentDepth = depth;
        contract = contracts[depth];
      }

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

  async doTraceWrapper (txHashOrCallObject) {
    this.pendingTraces++;
    try {
      await this.doTrace(txHashOrCallObject);
    } finally {
      this.pendingTraces--;
    }
  }

  async finish () {
    while (true) {
      if (this.pendingTraces === 0) {
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
};

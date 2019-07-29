# develatus-apparatus - Solidity coverage tool 🛠🔬

## How it works

The develatus-apparatus (👏) acts as a RPC proxy between your node and application / integration tests.
It intercepts `eth_sendRawTransaction` calls and uses `debug_traceTransaction` to create
a coverage report for Contracts it derives from your build artifacts.

### Notes

- Tested with geth v1.8.21.
- Uses the `debug_traceTransaction` - JavaScript Tracer
- You may have to enable the debug-rpc api. Like `--rpcapi=eth,net,web3,debug`

## How to use

Just run `develatus-apparatus` inside your project folder,
it reads a configuration file named `.develatus-apparatus.js `.

Example contents of that file:

```
module.exports = {
  testCommand: 'yarn mocha --timeout 120000 test/contracts/*.js',
  artifactsPath: 'build/contracts',
  proxyPort: 8333,
  rpcUrl: 'http://localhost:8222',
};
```

## TODO: More readme 🍪

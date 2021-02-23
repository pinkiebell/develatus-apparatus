# develatus-apparatus - Solidity coverage tool 🛠🔬

![develatus-apparatus](https://repository-images.githubusercontent.com/199478599/115de100-b2e9-11e9-8d27-4625885ca29c)

## How it works

The develatus-apparatus (👏) acts as a RPC proxy between your node and application / integration tests.
It intercepts `eth_call`, `eth_sendTransaction` and `eth_sendRawTransaction` calls and uses `debug_trace{Transaction||Call}` to create
a coverage report for Contracts it derives from your build artifacts.

### Notes

- Tested with geth v1.9.25.
- Uses the `debug_trace{Transaction||Call}` - JavaScript Tracer
- You may have to enable the debug-rpc api. Like `--rpcapi=eth,net,web3,debug`

## How to use

Just run `develatus-apparatus` inside your project folder,
it reads a configuration file named `.develatus-apparatus.js `.

Example contents of that file:

```
export default {
  testCommand: 'yarn mocha --timeout 120000 test/contracts/*.js',
  artifactsPath: 'build/contracts',
  proxyPort: 8333,
  rpcUrl: 'http://localhost:8222',
};
```

## TODO: More readme 🍪

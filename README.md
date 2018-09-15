# grpc-server-js

[![Current Version](https://img.shields.io/npm/v/grpc-server-js.svg)](https://www.npmjs.org/package/grpc-server-js)
[![Build Status via Travis CI](https://travis-ci.org/cjihrig/grpc-server-js.svg?branch=master)](https://travis-ci.org/cjihrig/grpc-server-js)
![Dependencies](http://img.shields.io/david/cjihrig/grpc-server-js.svg)
[![belly-button-style](https://img.shields.io/badge/eslint-bellybutton-4B32C3.svg)](https://github.com/cjihrig/belly-button)

Pure JavaScript gRPC Server

## Public API Deviations from `grpc.Server`

- `Server.prototype.bind()` is an `async` function.
- The deprecated `Server.prototype.addProtoService()` is not implemented.
- `Server.prototype.addHttp2Port()` is not implemented.
- The `private_key` and `cert_chain` properties of `keyCertPair` instances have
  been renamed to `privateKey` and `certChain`.

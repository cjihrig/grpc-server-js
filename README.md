# grpc-server-js

[![Current Version](https://img.shields.io/npm/v/grpc-server-js.svg)](https://www.npmjs.org/package/grpc-server-js)
![grpc-server-js CI](https://github.com/cjihrig/grpc-server-js/workflows/grpc-server-js%20CI/badge.svg)
![Dependencies](http://img.shields.io/david/cjihrig/grpc-server-js.svg)
[![belly-button-style](https://img.shields.io/badge/eslint-bellybutton-4B32C3.svg)](https://github.com/cjihrig/belly-button)

Pure JavaScript gRPC Server

## Documentation

The goal is to be largely compatible with the existing [`Server`](https://grpc.io/grpc/node/grpc.Server.html) implementation.

## Features

- [Unary calls](https://grpc.github.io/grpc/node/grpc-ServerUnaryCall.html).
- [Streaming client request calls](https://grpc.github.io/grpc/node/grpc-ServerReadableStream.html).
- [Streaming server response calls](https://grpc.github.io/grpc/node/grpc-ServerWritableStream.html).
- [Bidirectional streaming calls](https://grpc.github.io/grpc/node/grpc-ServerDuplexStream.html).
- Deadline and cancellation support.
- Support for gzip and deflate compression, as well as uncompressed messages.
- [Server credentials](https://grpc.github.io/grpc/node/grpc.ServerCredentials.html) for handling both secure and insecure calls.
- [gRPC Metadata](https://grpc.github.io/grpc/node/grpc.Metadata.html).
- gRPC logging.
- No production dependencies.
- No C++ dependencies. This implementation relies on Node's [`http2`](https://nodejs.org/api/http2.html) module.
- Supports the following gRPC server options:
  - `grpc.http2.max_frame_size`
  - `grpc.keepalive_time_ms`
  - `grpc.keepalive_timeout_ms`
  - `grpc.max_concurrent_streams`
  - All possible options and their descriptions are available [here](https://github.com/grpc/grpc/blob/master/include/grpc/impl/codegen/grpc_types.h).
- Supports the following gRPC environment variables:
  - `GRPC_DEFAULT_SSL_ROOTS_FILE_PATH`
  - `GRPC_SSL_CIPHER_SUITES`
  - `GRPC_VERBOSITY`
  - All possible environment variables and their descriptions are available [here](https://github.com/grpc/grpc/blob/master/doc/environment_variables.md).

## Public API Deviations from the Existing `grpc.Server`

- `Server.prototype.bind()` is an `async` function.
- The deprecated `Server.prototype.addProtoService()` is not implemented.
- `Server.prototype.addHttp2Port()` is not implemented.

## Useful References

- [What is gRPC?](https://grpc.io/docs/guides/index.html)
- [gRPC over HTTP2](https://github.com/grpc/grpc/blob/master/doc/PROTOCOL-HTTP2.md)
- [gRPC Compression](https://github.com/grpc/grpc/blob/master/doc/compression.md)
- [gRPC Environment Variables](https://github.com/grpc/grpc/blob/master/doc/environment_variables.md)
- [gRPC Keepalive](https://github.com/grpc/grpc/blob/master/doc/keepalive.md)
- [gRPC Name Resolution](https://github.com/grpc/grpc/blob/master/doc/naming.md)
- [gRPC Status Codes](https://github.com/grpc/grpc/blob/master/doc/statuscodes.md)

## Acknowledgement

This module is heavily inspired by the [`grpc`](https://www.npmjs.com/package/grpc) native module. Some of the source code is adapted from the [`@grpc/grpc-js`](https://www.npmjs.com/package/@grpc/grpc-js) module.

'use strict';
const Assert = require('assert');
const Path = require('path');
const Lab = require('@hapi/lab');
const { resolveToListenOptions } = require('../lib/server-resolver');

// Test shortcuts
const { describe, it } = exports.lab = Lab.script();


// Note(cjihrig): As of @grpc/grpc-js@0.6.15, the client claims to support Unix
// domain sockets. However, testing the grpc-js client did not seem to work.
// Testing grpcurl with the flags `-plaintext -unix -authority 'localhost'` did
// work for an insecure server.
describe('Server Resolver', () => {
  it('resolveToListenOptions() successfully parses inputs', () => {
    [
      [
        resolveToListenOptions('dns:localhost:81', true),
        { host: 'localhost', port: 81 }
      ],
      [
        resolveToListenOptions('dns:127.0.0.1:9999', true),
        { host: '127.0.0.1', port: 9999 }
      ],
      [
        resolveToListenOptions('dns:foo.bar.com:9999', false),
        { host: 'foo.bar.com', port: 9999 }
      ],
      [
        resolveToListenOptions('localhost:8080', true),
        { host: 'localhost', port: 8080 }
      ],
      [
        resolveToListenOptions('localhost:8080', false),
        { host: 'localhost', port: 8080 }
      ],
      [
        resolveToListenOptions('[::1]:123', true),
        { host: '[::1]', port: 123 }
      ],
      [
        resolveToListenOptions('[::1]', true),
        { host: '[::1]', port: 443 }
      ],
      [
        resolveToListenOptions('[::1]:80', true),
        { host: '[::1]', port: 80 }
      ],
      [
        resolveToListenOptions('localhost', true),
        { host: 'localhost', port: 443 }
      ],
      [
        resolveToListenOptions('localhost', false),
        { host: 'localhost', port: 80 }
      ],
      [
        resolveToListenOptions('localhost:80', false),
        { host: 'localhost', port: 80 }
      ],
      [
        resolveToListenOptions('localhost:80', true),
        { host: 'localhost', port: 80 }
      ],
      [
        resolveToListenOptions('localhost:81', true),
        { host: 'localhost', port: 81 }
      ],
      [
        resolveToListenOptions('localhost:443', false),
        { host: 'localhost', port: 443 }
      ],
      [
        resolveToListenOptions('dns:///localhost', false),
        { host: 'localhost', port: 80 }
      ],
      [
        resolveToListenOptions('unix:/foo/bar1', false),
        { path: Path.resolve('/foo/bar1') }
      ],
      [
        resolveToListenOptions('unix:./foo/../baz/bar2', false),
        { path: Path.join(process.cwd(), 'baz', 'bar2') }
      ],
      [
        resolveToListenOptions('unix:///foo/bar3', false),
        { path: '/foo/bar3' }
      ]
    ].forEach(([actual, expected]) => {
      Assert.deepStrictEqual(actual, expected);
    });
  });

  it('resolveToListenOptions() throws if unix:// path is not absolute', () => {
    Assert.throws(() => {
      resolveToListenOptions('unix://./foo', false);
    }, /^Error: 'unix:\/\/\.\/foo' must specify an absolute path$/);
  });
});

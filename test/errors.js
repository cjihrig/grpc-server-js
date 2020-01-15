'use strict';
const Assert = require('assert');
const Path = require('path');
const Barrier = require('cb-barrier');
const Lab = require('@hapi/lab');
const Grpc = require('@grpc/grpc-js');
const { Server, ServerCredentials } = require('../lib');
const { loadProtoFile } = require('./common');

// Test shortcuts
const lab = exports.lab = Lab.script();
const { describe, it, before, after } = lab;


const protoFile = Path.join(__dirname, 'proto', 'test_service.proto');
const testServiceDef = loadProtoFile(protoFile);
const TestServiceClient = testServiceDef.TestService;
const clientInsecureCreds = Grpc.credentials.createInsecure();
const serverInsecureCreds = ServerCredentials.createInsecure();


describe('Client malformed response handling', () => {
  let server;
  let client;
  const badArg = Buffer.from([0xFF]);

  before(async () => {
    const malformedTestService = {
      unary: {
        path: '/TestService/Unary',
        requestStream: false,
        responseStream: false,
        requestDeserialize: identity,
        responseSerialize: identity
      },
      clientStream: {
        path: '/TestService/ClientStream',
        requestStream: true,
        responseStream: false,
        requestDeserialize: identity,
        responseSerialize: identity
      },
      serverStream: {
        path: '/TestService/ServerStream',
        requestStream: false,
        responseStream: true,
        requestDeserialize: identity,
        responseSerialize: identity
      },
      bidiStream: {
        path: '/TestService/BidiStream',
        requestStream: true,
        responseStream: true,
        requestDeserialize: identity,
        responseSerialize: identity
      }
    };

    server = new Server();

    server.addService(malformedTestService, {
      unary (call, cb) {
        cb(null, badArg);
      },

      clientStream (stream, cb) {
        stream.on('data', noop);
        stream.on('end', () => {
          cb(null, badArg);
        });
      },

      serverStream (stream) {
        stream.write(badArg);
        stream.end();
      },

      bidiStream (stream) {
        stream.on('data', () => {
          // Ignore requests
          stream.write(badArg);
        });

        stream.on('end', () => {
          stream.end();
        });
      }
    });

    const port = await server.bind('localhost:0', serverInsecureCreds);
    client = new TestServiceClient(`localhost:${port}`, clientInsecureCreds);
    server.start();
  });

  after(() => {
    client.close();
    server.forceShutdown();
  });

  it('should get an INTERNAL status with a unary call', () => {
    const barrier = new Barrier();

    client.unary({}, (err, data) => {
      Assert(err);
      Assert.strictEqual(err.code, Grpc.status.INTERNAL);
      barrier.pass();
    });

    return barrier;
  });

  it('should get an INTERNAL status with a client stream call', () => {
    const barrier = new Barrier();
    const call = client.clientStream((err, data) => {
      Assert(err);
      Assert.strictEqual(err.code, Grpc.status.INTERNAL);
      barrier.pass();
    });

    call.write({});
    call.end();

    return barrier;
  });

  it('should get an INTERNAL status with a server stream call', () => {
    const barrier = new Barrier();
    const call = client.serverStream({});

    call.on('data', noop);
    call.on('error', (err) => {
      Assert(err);
      Assert.strictEqual(err.code, Grpc.status.INTERNAL);
      barrier.pass();
    });

    return barrier;
  });

  it('should get an INTERNAL status with a bidi stream call', () => {
    const barrier = new Barrier();
    const call = client.bidiStream();

    call.on('data', noop);
    call.on('error', (err) => {
      Assert(err);
      Assert.strictEqual(err.code, Grpc.status.INTERNAL);
      barrier.pass();
    });

    call.write({});
    call.end();

    return barrier;
  });
});

describe('Server serialization failure handling', () => {
  let client;
  let server;

  before(async () => {
    function serializeFail (obj) {
      throw new Error('Serialization failed');
    }

    const malformedTestService = {
      unary: {
        path: '/TestService/Unary',
        requestStream: false,
        responseStream: false,
        requestDeserialize: identity,
        responseSerialize: serializeFail
      },
      clientStream: {
        path: '/TestService/ClientStream',
        requestStream: true,
        responseStream: false,
        requestDeserialize: identity,
        responseSerialize: serializeFail
      },
      serverStream: {
        path: '/TestService/ServerStream',
        requestStream: false,
        responseStream: true,
        requestDeserialize: identity,
        responseSerialize: serializeFail
      },
      bidiStream: {
        path: '/TestService/BidiStream',
        requestStream: true,
        responseStream: true,
        requestDeserialize: identity,
        responseSerialize: serializeFail
      }
    };

    server = new Server();
    server.addService(malformedTestService, {
      unary (call, cb) {
        cb(null, {});
      },

      clientStream (stream, cb) {
        stream.on('data', noop);
        stream.on('end', () => {
          cb(null, {});
        });
      },

      serverStream (stream) {
        stream.write({});
        stream.end();
      },

      bidiStream (stream) {
        stream.on('data', () => {
          // Ignore requests
          stream.write({});
        });
        stream.on('end', () => {
          stream.end();
        });
      }
    });

    const port = await server.bind('localhost:0', serverInsecureCreds);

    client = new TestServiceClient(`localhost:${port}`, clientInsecureCreds);
    server.start();
  });

  after(() => {
    client.close();
    server.forceShutdown();
  });

  it('should get an INTERNAL status with a unary call', () => {
    const barrier = new Barrier();

    client.unary({}, (err, data) => {
      Assert(err);
      Assert.strictEqual(err.code, Grpc.status.INTERNAL);
      barrier.pass();
    });

    return barrier;
  });

  it('should get an INTERNAL status with a client stream call', () => {
    const barrier = new Barrier();
    const call = client.clientStream((err, data) => {
      Assert(err);
      Assert.strictEqual(err.code, Grpc.status.INTERNAL);
      barrier.pass();
    });

    call.write({});
    call.end();

    return barrier;
  });

  it('should get an INTERNAL status with a server stream call', () => {
    const barrier = new Barrier();
    const call = client.serverStream({});

    call.on('data', noop);
    call.on('error', (err) => {
      Assert(err);
      Assert.strictEqual(err.code, Grpc.status.INTERNAL);
      barrier.pass();
    });

    return barrier;
  });

  it('should get an INTERNAL status with a bidi stream call', () => {
    const barrier = new Barrier();
    const call = client.bidiStream();

    call.on('data', noop);
    call.on('error', (err) => {
      Assert(err);
      Assert.strictEqual(err.code, Grpc.status.INTERNAL);
      barrier.pass();
    });

    call.write({});
    call.end();

    return barrier;
  });
});

describe('Other conditions', () => {
  let client;
  let server;
  let port;

  before(async () => {
    const trailerMetadata = new Grpc.Metadata();
    const existingMetadata = new Grpc.Metadata();

    server = new Server();
    trailerMetadata.add('trailer-present', 'yes');
    existingMetadata.add('existing-present', 'yes');

    server.addService(TestServiceClient.service, {
      unary (call, cb) {
        const req = call.request;

        if (req.error) {
          const details = req.message || 'Requested error';
          const response = {
            code: Grpc.status.UNKNOWN,
            details
          };

          if (req.message === 'existing-metadata') {
            response.metadata = existingMetadata;
          }

          cb(response, null, trailerMetadata);
        } else {
          cb(null, { count: 1 }, trailerMetadata);
        }
      },

      clientStream (stream, cb) {
        let count = 0;
        let errored;

        stream.on('data', (data) => {
          if (data.error) {
            const message = data.message || 'Requested error';
            errored = true;
            cb(new Error(message), null, trailerMetadata);
          } else {
            count++;
          }
        });

        stream.on('end', () => {
          if (!errored) {
            cb(null, { count }, trailerMetadata);
          }
        });
      },

      serverStream (stream) {
        const req = stream.request;

        if (req.error) {
          stream.emit('error', {
            code: Grpc.status.UNKNOWN,
            details: req.message || 'Requested error',
            metadata: trailerMetadata
          });
        } else {
          for (let i = 0; i < 5; i++) {
            stream.write({ count: i });
          }

          stream.end(trailerMetadata);
        }
      },

      bidiStream (stream) {
        let count = 0;
        stream.on('data', (data) => {
          if (data.error) {
            const message = data.message || 'Requested error';
            const err = new Error(message);

            err.metadata = trailerMetadata.clone();
            err.metadata.add('count', '' + count);
            stream.emit('error', err);
          } else {
            stream.write({ count });
            count++;
          }
        });

        stream.on('end', () => {
          stream.end(trailerMetadata);
        });
      }
    });

    port = await server.bind('localhost:0', serverInsecureCreds);
    client = new TestServiceClient(`localhost:${port}`, clientInsecureCreds);
    server.start();
  });

  after(function () {
    client.close();
    server.forceShutdown();
  });

  describe('Server receiving bad input', () => {
    let misbehavingClient;
    const badArg = Buffer.from([0xFF]);

    before(() => {
      const testServiceAttrs = {
        unary: {
          path: '/TestService/Unary',
          requestStream: false,
          responseStream: false,
          requestSerialize: identity,
          responseDeserialize: identity
        },
        clientStream: {
          path: '/TestService/ClientStream',
          requestStream: true,
          responseStream: false,
          requestSerialize: identity,
          responseDeserialize: identity
        },
        serverStream: {
          path: '/TestService/ServerStream',
          requestStream: false,
          responseStream: true,
          requestSerialize: identity,
          responseDeserialize: identity
        },
        bidiStream: {
          path: '/TestService/BidiStream',
          requestStream: true,
          responseStream: true,
          requestSerialize: identity,
          responseDeserialize: identity
        }
      };

      const Client = Grpc.makeGenericClientConstructor(testServiceAttrs, 'TestService');

      misbehavingClient = new Client(`localhost:${port}`, clientInsecureCreds);
    });

    after(() => {
      misbehavingClient.close();
    });

    it('should respond correctly to a unary call', () => {
      const barrier = new Barrier();

      misbehavingClient.unary(badArg, (err, data) => {
        Assert(err);
        Assert.strictEqual(err.code, Grpc.status.INTERNAL);
        barrier.pass();
      });

      return barrier;
    });

    it('should respond correctly to a client stream', () => {
      const barrier = new Barrier();
      const call = misbehavingClient.clientStream((err, data) => {
        Assert(err);
        Assert.strictEqual(err.code, Grpc.status.INTERNAL);
        barrier.pass();
      });

      call.write(badArg);
      call.end();

      return barrier;
    });

    it('should respond correctly to a server stream', () => {
      const barrier = new Barrier();
      const call = misbehavingClient.serverStream(badArg);

      call.on('data', (data) => {
        Assert.fail(data);
      });

      call.on('error', (err) => {
        Assert(err);
        Assert.strictEqual(err.code, Grpc.status.INTERNAL);
        barrier.pass();
      });

      return barrier;
    });

    it('should respond correctly to a bidi stream', () => {
      const barrier = new Barrier();
      const call = misbehavingClient.bidiStream();

      call.on('data', (data) => {
        Assert.fail(data);
      });

      call.on('error', (err) => {
        Assert(err);
        Assert.strictEqual(err.code, Grpc.status.INTERNAL);
        barrier.pass();
      });

      call.write(badArg);
      call.end();
      return barrier;
    });
  });

  describe('Trailing metadata', () => {
    it('should be present when a unary call succeeds', () => {
      const barrier = new Barrier(2);
      const call = client.unary({ error: false }, (err, data) => {
        Assert.ifError(err);
        barrier.pass();
      });

      call.on('status', (status) => {
        Assert.deepStrictEqual(status.metadata.get('trailer-present'), ['yes']);
        barrier.pass();
      });

      return barrier;
    });

    it('should be present when a unary call fails', () => {
      const barrier = new Barrier(2);
      const call = client.unary({ error: true }, (err, data) => {
        Assert(err);
        barrier.pass();
      });

      call.on('status', (status) => {
        Assert.deepStrictEqual(status.metadata.get('trailer-present'), ['yes']);
        barrier.pass();
      });

      return barrier;
    });

    it('should be present when a client stream call succeeds', () => {
      const barrier = new Barrier(2);
      const call = client.clientStream((err, data) => {
        Assert.ifError(err);
        barrier.pass();
      });

      call.write({ error: false });
      call.write({ error: false });
      call.end();

      call.on('status', (status) => {
        Assert.deepStrictEqual(status.metadata.get('trailer-present'), ['yes']);
        barrier.pass();
      });

      return barrier;
    });

    it('should be present when a client stream call fails', () => {
      const barrier = new Barrier(2);
      const call = client.clientStream((err, data) => {
        Assert(err);
        barrier.pass();
      });

      call.write({ error: false });
      call.write({ error: true });
      call.end();

      call.on('status', (status) => {
        Assert.deepStrictEqual(status.metadata.get('trailer-present'), ['yes']);
        barrier.pass();
      });

      return barrier;
    });

    it('should be present when a server stream call succeeds', () => {
      const barrier = new Barrier();
      const call = client.serverStream({ error: false });

      call.on('data', noop);
      call.on('status', (status) => {
        Assert.strictEqual(status.code, Grpc.status.OK);
        Assert.deepStrictEqual(status.metadata.get('trailer-present'), ['yes']);
        barrier.pass();
      });

      return barrier;
    });

    it('should be present when a server stream call fails', () => {
      const barrier = new Barrier();
      const call = client.serverStream({ error: true });

      call.on('data', noop);
      call.on('error', (error) => {
        Assert.deepStrictEqual(error.metadata.get('trailer-present'), ['yes']);
        barrier.pass();
      });

      return barrier;
    });

    it('should be present when a bidi stream succeeds', () => {
      const barrier = new Barrier();
      const call = client.bidiStream();

      call.write({ error: false });
      call.write({ error: false });
      call.end();
      call.on('data', noop);
      call.on('status', (status) => {
        Assert.strictEqual(status.code, Grpc.status.OK);
        Assert.deepStrictEqual(status.metadata.get('trailer-present'), ['yes']);
        barrier.pass();
      });

      return barrier;
    });

    it('should be present when a bidi stream fails', () => {
      const barrier = new Barrier();
      const call = client.bidiStream();

      call.write({ error: false });
      call.write({ error: true });
      call.end();
      call.on('data', noop);
      call.on('error', (error) => {
        Assert.deepStrictEqual(error.metadata.get('trailer-present'), ['yes']);
        barrier.pass();
      });

      return barrier;
    });
  });

  it('existing metadata is not overwritten when a unary call fails', () => {
    const barrier = new Barrier(2);
    const call = client.unary({
      error: true,
      message: 'existing-metadata'
    }, (err, data) => {
      Assert(err);
      barrier.pass();
    });

    call.on('status', (status) => {
      Assert.deepStrictEqual(status.metadata.get('existing-present'), ['yes']);
      barrier.pass();
    });

    return barrier;
  });

  describe('Error object should contain the status', () => {
    it('for a unary call', () => {
      const barrier = new Barrier();

      client.unary({ error: true }, (err, data) => {
        Assert(err);
        Assert.strictEqual(err.code, Grpc.status.UNKNOWN);
        Assert.strictEqual(err.details, 'Requested error');
        barrier.pass();
      });

      return barrier;
    });

    it('for a client stream call', () => {
      const barrier = new Barrier();
      const call = client.clientStream((err, data) => {
        Assert(err);
        Assert.strictEqual(err.code, Grpc.status.UNKNOWN);
        Assert.strictEqual(err.details, 'Requested error');
        barrier.pass();
      });

      call.write({ error: false });
      call.write({ error: true });
      call.end();

      return barrier;
    });

    it('for a server stream call', () => {
      const barrier = new Barrier();
      const call = client.serverStream({ error: true });

      call.on('data', noop);
      call.on('error', (error) => {
        Assert.strictEqual(error.code, Grpc.status.UNKNOWN);
        Assert.strictEqual(error.details, 'Requested error');
        barrier.pass();
      });

      return barrier;
    });

    it('for a bidi stream call', () => {
      const barrier = new Barrier();
      const call = client.bidiStream();

      call.write({ error: false });
      call.write({ error: true });
      call.end();
      call.on('data', noop);
      call.on('error', (error) => {
        Assert.strictEqual(error.code, Grpc.status.UNKNOWN);
        Assert.strictEqual(error.details, 'Requested error');
        barrier.pass();
      });

      return barrier;
    });

    it('for a UTF-8 error message', () => {
      const barrier = new Barrier();

      client.unary({ error: true, message: '測試字符串' }, (err, data) => {
        Assert(err);
        Assert.strictEqual(err.code, Grpc.status.UNKNOWN);
        Assert.strictEqual(err.details, '測試字符串');
        barrier.pass();
      });

      return barrier;
    });

    it('for an error message containing a comma', () => {
      const barrier = new Barrier();

      client.unary({ error: true, message: 'foo, bar, and baz' }, (err, data) => {
        Assert(err);
        Assert.strictEqual(err.code, Grpc.status.UNKNOWN);
        Assert.strictEqual(err.details, 'foo, bar, and baz');
        barrier.pass();
      });

      return barrier;
    });
  });
});


function identity (arg) {
  return arg;
}


function noop () {}

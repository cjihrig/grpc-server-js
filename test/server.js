'use strict';
const Assert = require('assert');
const Fs = require('fs');
const Http2 = require('http2');
const Path = require('path');
const Barrier = require('cb-barrier');
const Lab = require('@hapi/lab');
const Grpc = require('@grpc/grpc-js');
const { Server, ServerCredentials } = require('../lib');
const { loadProtoFile } = require('./common');

// Test shortcuts
const lab = exports.lab = Lab.script();
const { describe, it, before, after, beforeEach, afterEach } = lab;


const clientInsecureCreds = Grpc.credentials.createInsecure();
const serverInsecureCreds = ServerCredentials.createInsecure();


describe('Server', () => {
  describe('constructor', () => {
    it('should work with no arguments', () => {
      Assert.doesNotThrow(() => {
        new Server(); // eslint-disable-line no-new
      });
    });

    it('should work with an empty object argument', () => {
      const options = {};

      Assert.doesNotThrow(() => {
        new Server(options); // eslint-disable-line no-new
      });

      // The constructor applies default values. Verify that the user's
      // options are not overwritten.
      Assert.deepStrictEqual(options, {});
    });

    it('throws if arguments are the wrong type', () => {
      [null, 'foo', 5].forEach((value) => {
        Assert.throws(() => {
          new Server(value); // eslint-disable-line no-new
        }, /TypeError: options must be an object/);
      });
    });

    it('should be an instance of Server', () => {
      const server = new Server();

      Assert(server instanceof Server);
    });
  });

  describe('bind', () => {
    it('uses insecure credentials by default', async () => {
      const server = new Server();

      server.bindAsync = function (port, creds, callback) {
        Assert.strictEqual(creds._isSecure(), false);
        callback(null, 1000);
      };

      await server.bind('localhost:0');
      await server.bind('localhost:0', null);
    });

    it('handles errors during binding', async () => {
      const server = new Server();

      server.bindAsync = function (port, creds, callback) {
        callback(new Error('test error'), -1);
      };

      await Assert.rejects(async () => {
        await server.bind('localhost:0');
      }, /^Error: test error$/);
    });
  });

  describe('bindAsync', () => {
    it('binds with insecure credentials', () => {
      const server = new Server();
      const barrier = new Barrier();

      server.bindAsync('localhost:0', serverInsecureCreds, (err, port) => {
        Assert.ifError(err);
        Assert(typeof port === 'number' && port > 0);
        server.tryShutdown(barrier.pass);
      });

      return barrier;
    });

    it('binds with secure credentials', () => {
      const server = new Server();
      const barrier = new Barrier();
      const ca = Fs.readFileSync(Path.join(__dirname, 'fixtures', 'ca.pem'));
      const key = Fs.readFileSync(Path.join(__dirname, 'fixtures', 'server1.key'));
      const cert = Fs.readFileSync(Path.join(__dirname, 'fixtures', 'server1.pem'));

      const creds = ServerCredentials.createSsl(ca,
        [{ private_key: key, cert_chain: cert }], true);

      server.bindAsync('localhost:0', creds, (err, port) => {
        Assert.ifError(err);
        Assert(typeof port === 'number' && port > 0);
        server.tryShutdown(barrier.pass);
      });

      return barrier;
    });

    it('throws if bind is called after the server is started', () => {
      const server = new Server();
      const barrier = new Barrier();

      server.bindAsync('localhost:0', serverInsecureCreds, (err, port) => {
        Assert.ifError(err);
        server.start();
        Assert.throws(() => {
          server.bindAsync('localhost:0', serverInsecureCreds, () => {});
        }, /server is already started/);
        server.tryShutdown(barrier.pass);
      });

      return barrier;
    });

    it('handles errors while trying to bind', () => {
      const server1 = new Server();
      const server2 = new Server();
      const barrier = new Barrier();

      server1.bindAsync('localhost:0', serverInsecureCreds, (err, port) => {
        Assert.ifError(err);
        Assert(typeof port === 'number' && port > 0);
        server2.bindAsync(`localhost:${port}`, serverInsecureCreds, (err, port) => {
          Assert.strictEqual(err.code, 'EADDRINUSE');
          Assert.strictEqual(port, -1);
          server1.tryShutdown(() => {
            server2.tryShutdown(barrier.pass);
          });
        });
      });

      return barrier;
    });

    it('throws on invalid inputs', () => {
      const server = new Server();

      Assert.throws(() => {
        server.bindAsync(null, serverInsecureCreds, () => {});
      }, /port must be a string/);

      Assert.throws(() => {
        server.bindAsync('localhost:0', null, () => {});
      }, /creds must be an object/);

      Assert.throws(() => {
        server.bindAsync('localhost:0', 'foo', () => {});
      }, /creds must be an object/);

      Assert.throws(() => {
        server.bindAsync('localhost:0', serverInsecureCreds, null);
      }, /callback must be a function/);
    });
  });

  describe('start', () => {
    let server;

    beforeEach(async () => {
      server = new Server();
      await server.bind(8000, ServerCredentials.createInsecure());
    });

    afterEach(() => {
      server.forceShutdown();
    });

    it('should start without error', () => {
      Assert.doesNotThrow(() => {
        server.start();
      });
    });

    it('should error if started twice', () => {
      server.start();
      Assert.throws(() => {
        server.start();
      }, /server is already started/);
    });

    it('should error if bind is called after the server starts', () => {
      server.start();
      Assert.rejects(async () => {
        await server.bind('localhost:0', serverInsecureCreds);
      }, /server is already started/);
    });

    it('throws if the server is not bound', () => {
      const server = new Server();

      Assert.throws(() => {
        server.start();
      }, /server must be bound in order to start/);
    });
  });

  describe('Server.prototype.addService', () => {
    const mathProtoFile = Path.join(__dirname, 'proto', 'math.proto');
    const MathClient = loadProtoFile(mathProtoFile).math.Math;
    const mathServiceAttrs = MathClient.service;
    const dummyImpls = {
      div () {},
      divMany () {},
      fib () {},
      sum () {}
    };
    const altDummyImpls = {
      Div () {},
      DivMany () {},
      Fib () {},
      Sum () {}
    };
    let server;

    beforeEach(() => {
      server = new Server();
    });

    afterEach(() => {
      server.forceShutdown();
    });

    it('Should succeed with a single service', () => {
      Assert.doesNotThrow(() => {
        server.addService(mathServiceAttrs, dummyImpls);
      });
    });

    it('Should fail with conflicting method names', () => {
      server.addService(mathServiceAttrs, dummyImpls);
      Assert.throws(() => {
        server.addService(mathServiceAttrs, dummyImpls);
      });
    });

    it('Should allow method names as originally written', () => {
      Assert.doesNotThrow(() => {
        server.addService(mathServiceAttrs, altDummyImpls);
      });
    });

    it('Should fail if the server has been started', async () => {
      await server.bind('localhost:0', serverInsecureCreds);
      server.start();
      Assert.throws(() => {
        server.addService(mathServiceAttrs, dummyImpls);
      }, /Can't add a service to a started server\./);
    });

    it('fails trying to add an empty service', () => {
      Assert.throws(() => {
        server.addService({}, {});
      }, /^Error: Cannot add an empty service to a server$/);
    });

    it('fails if both inputs are not objects', () => {
      [
        [null, {}],
        ['foo', {}],
        [{}, null],
        [{}, 'foo']
      ].forEach((inputs) => {
        Assert.throws(() => {
          server.addService(inputs[0], inputs[1]);
        });
      });
    });

    describe('Default handlers', () => {
      let client;

      beforeEach(async () => {
        server.addService(mathServiceAttrs, {});
        const port = await server.bind('localhost:0', serverInsecureCreds);
        client = new MathClient(`localhost:${port}`, clientInsecureCreds);
        server.start();
      });

      afterEach(() => {
        client.close();
        server.forceShutdown();
      });

      it('should respond to a unary call with UNIMPLEMENTED', () => {
        const barrier = new Barrier();

        client.div({ divisor: 4, dividend: 3 }, (error, response) => {
          Assert(error);
          Assert.strictEqual(error.code, Grpc.status.UNIMPLEMENTED);
          Assert.strictEqual(error.details, 'The server does not implement the method Div');
          barrier.pass();
        });

        return barrier;
      });

      it('should respond to a client stream with UNIMPLEMENTED', () => {
        const barrier = new Barrier();
        const call = client.sum((error, respones) => {
          Assert(error);
          Assert.strictEqual(error.code, Grpc.status.UNIMPLEMENTED);
          Assert.strictEqual(error.details, 'The server does not implement the method Sum');
          barrier.pass();
        });

        call.end();
        return barrier;
      });

      it('should respond to a server stream with UNIMPLEMENTED', () => {
        const barrier = new Barrier();
        const call = client.fib({ limit: 5 });

        call.on('data', (value) => {
          Assert.fail('No messages expected');
        });

        call.on('error', (err) => {
          Assert(err);
          Assert.strictEqual(err.code, Grpc.status.UNIMPLEMENTED);
          Assert.strictEqual(err.details, 'The server does not implement the method Fib');
          barrier.pass();
        });

        return barrier;
      });

      it('should respond to a bidi call with UNIMPLEMENTED', () => {
        const barrier = new Barrier();
        const call = client.divMany();

        call.on('data', (value) => {
          Assert.fail('No messages expected');
        });

        call.on('error', (err) => {
          Assert.strictEqual(err.code, Grpc.status.UNIMPLEMENTED);
          Assert.strictEqual(err.details, 'The server does not implement the method DivMany');
          barrier.pass();
        });

        call.end();

        return barrier;
      });
    });
  });

  describe('Server.prototype.tryShutdown', () => {
    it('calls back without an error if the server is not bound', () => {
      const barrier = new Barrier();
      const server = new Server();

      server.tryShutdown((err) => {
        Assert.ifError(err);
        barrier.pass();
      });

      return barrier;
    });

    it('is idempotent with itself', async () => {
      const barrier = new Barrier();
      const server = new Server();

      await server.bind('localhost:0', serverInsecureCreds);
      server.start();
      server.tryShutdown((err) => {
        Assert.ifError(err);
        server.tryShutdown((err) => {
          Assert.ifError(err);
          barrier.pass();
        });
      });

      return barrier;
    });

    it('is idempotent with forceShutdown()', async () => {
      const barrier = new Barrier();
      const server = new Server();

      await server.bind('localhost:0', serverInsecureCreds);
      server.start();
      server.tryShutdown((err) => {
        Assert.ifError(err);
        server.forceShutdown();
        barrier.pass();
      });

      return barrier;
    });
  });

  describe('Server.prototype.forceShutdown', () => {
    it('does not throw if the server is not bound', () => {
      const server = new Server();

      server.forceShutdown();
    });

    it('is idempotent with itself', async () => {
      const server = new Server();

      await server.bind('localhost:0', serverInsecureCreds);
      server.start();
      server.forceShutdown();
      server.forceShutdown();
    });

    it('is idempotent with tryShutdown()', async () => {
      const barrier = new Barrier();
      const server = new Server();

      await server.bind('localhost:0', serverInsecureCreds);
      server.start();
      server.forceShutdown();
      server.tryShutdown((err) => {
        Assert.ifError(err);
        barrier.pass();
      });

      return barrier;
    });

    it('forcefully closes connections', async () => {
      const barrier = new Barrier();
      const server = new Server();
      const protoFile = Path.join(__dirname, 'proto', 'echo_service.proto');
      const { EchoService } = loadProtoFile(protoFile);
      let calledForceShutdown = false;
      let client; // eslint-disable-line prefer-const

      server.addService(EchoService.service, {
        echoBidiStream (stream) {
          // Verify that forceShutdown() triggers tryShutdown().
          server.tryShutdown(() => {
            Assert.strictEqual(calledForceShutdown, true);
            client.close();
            barrier.pass();
          });

          stream.write({});
        }
      });

      const port = await server.bind('localhost:0', serverInsecureCreds);
      client = new EchoService(`localhost:${port}`, clientInsecureCreds);
      server.start();
      const stream = client.echoBidiStream();

      stream.on('data', (message) => {
        Assert.deepStrictEqual(message, { value: '', value2: 0 });
        server.forceShutdown();
        calledForceShutdown = true;
      });

      stream.on('error', (err) => {
        Assert(err);
      });

      return barrier;
    });
  });

  describe('Echo service', () => {
    let server;
    let client;

    before(async () => {
      const protoFile = Path.join(__dirname, 'proto', 'echo_service.proto');
      const { EchoService } = loadProtoFile(protoFile);

      server = new Server();
      server.addService(EchoService.service, {
        echo (call, callback) {
          callback(null, call.request);
        }
      });

      const port = await server.bind('localhost:0', serverInsecureCreds);
      client = new EchoService(`localhost:${port}`, clientInsecureCreds);
      server.start();
    });

    after(() => {
      client.close();
      server.forceShutdown();
    });

    it('should echo the received message directly', () => {
      const barrier = new Barrier();

      client.echo({ value: 'test value', value2: 3 }, (error, response) => {
        Assert.ifError(error);
        Assert.deepStrictEqual(response, { value: 'test value', value2: 3 });
        barrier.pass();
      });

      return barrier;
    });
  });

  describe('Generic client and server', () => {
    function toString (val) {
      return val.toString();
    }

    function toBuffer (str) {
      return Buffer.from(str);
    }

    function capitalize (str) {
      return str.charAt(0).toUpperCase() + str.slice(1);
    }

    const stringServiceAttrs = {
      capitalize: {
        path: '/string/capitalize',
        requestStream: false,
        responseStream: false,
        requestSerialize: toBuffer,
        requestDeserialize: toString,
        responseSerialize: toBuffer,
        responseDeserialize: toString
      }
    };

    describe('String client and server', () => {
      let client;
      let server;

      before(async () => {
        server = new Server();

        server.addService(stringServiceAttrs, {
          capitalize (call, callback) {
            callback(null, capitalize(call.request));
          }
        });

        const port = await server.bind('localhost:0', serverInsecureCreds);
        server.start();
        const Client = Grpc.makeGenericClientConstructor(stringServiceAttrs);
        client = new Client(`localhost:${port}`, clientInsecureCreds);
      });

      after(() => {
        client.close();
        server.forceShutdown();
      });

      it('Should respond with a capitalized string', () => {
        const barrier = new Barrier();

        client.capitalize('abc', (err, response) => {
          Assert.ifError(err);
          Assert.strictEqual(response, 'Abc');
          barrier.pass();
        });

        return barrier;
      });
    });
  });

  it('throws when unimplemented methods are called', () => {
    const server = new Server();

    Assert.throws(() => {
      server.addProtoService();
    }, /not implemented. use addService\(\) instead/);

    Assert.throws(() => {
      server.addHttp2Port();
    }, /not implemented/);
  });

  it('responds with HTTP status of 415 on invalid content-type', async () => {
    const barrier = new Barrier();
    const server = new Server();
    const port = await server.bind('localhost:0', serverInsecureCreds);
    const client = Http2.connect(`http://localhost:${port}`);
    let count = 0;

    server.start();

    function makeRequest (headers) {
      const req = client.request(headers);
      let statusCode;

      req.on('response', (headers) => {
        statusCode = headers[Http2.constants.HTTP2_HEADER_STATUS];
      });

      req.on('end', () => {
        Assert.strictEqual(statusCode, Http2.constants.HTTP_STATUS_UNSUPPORTED_MEDIA_TYPE);
        count++;
        if (count === 2) {
          client.close();
          server.tryShutdown(barrier.pass);
        }
      });

      req.end();
    }

    // Missing Content-Type header.
    makeRequest({ ':path': '/' });
    // Invalid Content-Type header.
    makeRequest({ ':path': '/', 'content-type': 'application/not-grpc' });
    return barrier;
  });

  it('rejects connections if the server is bound but not started', async () => {
    const barrier = new Barrier();
    const server = new Server();
    const port = await server.bind('localhost:0', serverInsecureCreds);
    const protoFile = Path.join(__dirname, 'proto', 'echo_service.proto');
    const { EchoService } = loadProtoFile(protoFile);
    const client = new EchoService(`localhost:${port}`, clientInsecureCreds);

    client.echo({ value: 'test value', value2: 3 }, (error, response) => {
      Assert.strictEqual(error.code, Grpc.status.UNAVAILABLE);
      Assert.strictEqual(response, undefined);
      client.close();
      server.tryShutdown(barrier.pass);
    });

    return barrier;
  });

  it('returns UNIMPLEMENTED on 404', async () => {
    const barrier = new Barrier();
    const server = new Server();
    const port = await server.bind('localhost:0', serverInsecureCreds);
    const protoFile = Path.join(__dirname, 'proto', 'echo_service.proto');
    const { EchoService } = loadProtoFile(protoFile);
    const client = new EchoService(`localhost:${port}`, clientInsecureCreds);

    server.start();
    client.echo({ value: 'test value', value2: 3 }, (error, response) => {
      Assert.strictEqual(error.code, Grpc.status.UNIMPLEMENTED);
      Assert.strictEqual(error.details, 'The server does not implement the method /EchoService/Echo');
      Assert.strictEqual(response, undefined);
      client.close();
      server.tryShutdown(barrier.pass);
    });

    return barrier;
  });

  it('sends keepalive pings', async () => {
    const barrier = new Barrier();
    const server = new Server({
      'grpc.keepalive_time_ms': 10,
      'grpc.keepalive_timeout_ms': 1
    });
    const protoFile = Path.join(__dirname, 'proto', 'echo_service.proto');
    const { EchoService } = loadProtoFile(protoFile);

    server.addService(EchoService.service, {
      echoBidiStream (stream) {
        stream.on('data', (data) => {
          Assert.fail('no data events expected on server');
        });
      }
    });

    const port = await server.bind('localhost:0', serverInsecureCreds);
    const client = new EchoService(`localhost:${port}`, clientInsecureCreds);
    server.start();
    const stream = client.echoBidiStream();

    stream.on('close', () => {
      Assert.fail('close event not expected on client');
    });

    stream.on('end', () => {
      Assert.fail('end event not expected on client');
    });

    stream.on('error', (err) => {
      Assert(err);
      client.close();
      server.tryShutdown(barrier.pass);
    });

    return barrier;
  });

  it('handles multiple messages in a single frame', async () => {
    const barrier = new Barrier();
    const server = new Server();
    const protoFile = Path.join(__dirname, 'proto', 'echo_service.proto');
    const { EchoService } = loadProtoFile(protoFile);
    let receivedCount = 0;

    server.addService(EchoService.service, {
      echoBidiStream (stream) {
        stream.pause();

        setImmediate(() => {
          stream.resume();
        });

        stream.on('data', (data) => {
          Assert.deepStrictEqual(data, { value: '', value2: 0 });
          receivedCount++;

          // The value 20 is dependent on the number of bytes that each message
          // serializes to. If this test ever starts failing, it's likely due to
          // a change in protobuf.js, and the expected number may change.
          if (receivedCount === 20) {
            stream.end();
            client.close();     // eslint-disable-line no-use-before-define
            server.tryShutdown(barrier.pass);
          }
        });
      }
    });

    const port = await server.bind('localhost:0', serverInsecureCreds);
    server.start();

    const client = Http2.connect(`http://localhost:${port}`);
    const req = client.request({
      [Http2.constants.HTTP2_HEADER_PATH]: '/EchoService/EchoBidiStream',
      [Http2.constants.HTTP2_HEADER_METHOD]: 'POST',
      [Http2.constants.HTTP2_HEADER_CONTENT_TYPE]: 'application/grpc'
    });

    req.write(Buffer.alloc(100));
    req.end();
    return barrier;
  });

  it('stream handlers can serialize and deserialize messages', async () => {
    const barrier = new Barrier();
    const server = new Server();
    const protoFile = Path.join(__dirname, 'proto', 'echo_service.proto');
    const { EchoService } = loadProtoFile(protoFile);

    server.addService(EchoService.service, {
      echoBidiStream (stream) {
        stream.on('data', (data) => {
          Assert.deepStrictEqual(data, { value: '', value2: 0 });
          const bytes = stream.serialize(data);
          const message = stream.deserialize(bytes);

          // Verify serialize-deserialize functionality.
          Assert(bytes instanceof Buffer);
          Assert.deepStrictEqual(message, data);

          // Verify handling of edge cases.
          Assert.strictEqual(stream.serialize(null), null);
          Assert.strictEqual(stream.serialize(undefined), null);
          Assert.strictEqual(stream.deserialize(null), null);
          Assert.strictEqual(stream.deserialize(undefined), null);
          stream.end();
        });
      }
    });

    const port = await server.bind('localhost:0', serverInsecureCreds);
    const client = new EchoService(`localhost:${port}`, clientInsecureCreds);
    server.start();
    const stream = client.echoBidiStream();

    stream.write({});
    stream.on('status', () => {
      client.close();
      server.forceShutdown();
      barrier.pass();
    });
    stream.end();

    return barrier;
  });

  it('can serve traffic on multiple ports', async () => {
    const barrier = new Barrier();
    const protoFile = Path.join(__dirname, 'proto', 'echo_service.proto');
    const { EchoService } = loadProtoFile(protoFile);
    const server = new Server();

    server.addService(EchoService.service, {
      echo (call, callback) {
        callback(null, call.request);
      }
    });

    const port1 = await server.bind('localhost:0', serverInsecureCreds);
    const port2 = await server.bind('localhost:0', serverInsecureCreds);
    Assert.notStrictEqual(port1, port2);
    server.start();
    const client1 = new EchoService(`localhost:${port1}`, clientInsecureCreds);
    const client2 = new EchoService(`localhost:${port2}`, clientInsecureCreds);

    client1.echo({ value: 'test value', value2: 3 }, (error, response) => {
      Assert.ifError(error);
      Assert.deepStrictEqual(response, { value: 'test value', value2: 3 });
      client2.echo({ value: 'test two', value2: 99 }, (error, response) => {
        Assert.ifError(error);
        Assert.deepStrictEqual(response, { value: 'test two', value2: 99 });
        client1.close();
        client2.close();
        server.forceShutdown();
        barrier.pass();
      });
    });

    return barrier;
  });

  describe('Unix Domain Socket Support', () => {
    const protoFile = Path.join(__dirname, 'proto', 'echo_service.proto');
    const { EchoService } = loadProtoFile(protoFile);
    const tmpDir = Path.join(__dirname, '.tmpdir');
    let counter = 0;

    async function runTest (path) {
      const barrier = new Barrier();
      const server = new Server();

      server.addService(EchoService.service, {
        echo (call, callback) {
          Assert.strictEqual(call.getPeer(), 'unknown');
          callback(null, call.request);
        }
      });

      const port = await server.bind(path, serverInsecureCreds);
      Assert.strictEqual(port, undefined);
      server.start();
      const client = new EchoService(path, clientInsecureCreds);

      client.echo({ value: 'test value', value2: 42 }, (error, response) => {
        Assert.ifError(error);
        Assert.deepStrictEqual(response, { value: 'test value', value2: 42 });
        client.close();
        server.forceShutdown();
        barrier.pass();
      });

      return barrier;
    }

    function getAbsolutePath () {
      const file = Path.join(tmpDir, `test-sock-${counter++}`);

      if (process.platform === 'win32') {
        return Path.join('\\\\.\\pipe\\', file);
      }

      return file;
    }

    function getRelativePath () {
      const file = Path.join(Path.relative(process.cwd(), tmpDir),
        `test-sock-${counter++}`);

      if (process.platform === 'win32') {
        return Path.join('\\\\.\\pipe\\', file);
      }

      return file;
    }

    function cleanup () {
      try {
        Fs.readdirSync(tmpDir).forEach((entry) => {
          try {
            Fs.unlinkSync(entry);
          } catch (ignoreErr) {}
        });

        Fs.rmdirSync(tmpDir);
      } catch (ignoreErr) {}
    }

    before(() => {
      try {
        cleanup();
        Fs.mkdirSync(tmpDir);
      } catch (ignoreErr) {}
    });

    after(() => {
      cleanup();
    });

    it('handles unix: followed by an absolute path', async () => {
      const path = `unix:${getAbsolutePath()}`;
      await runTest(path);
    });

    it('handles unix: followed by a relative path', async () => {
      const path = `unix:${getRelativePath()}`;
      await runTest(path);
    });

    // Skip on Windows. The client no longer seems to connect.
    it('handles unix:// followed by an absolute path', { skip: process.platform === 'win32' }, async () => {
      const path = `unix://${getAbsolutePath()}`;
      await runTest(path);
    });

    // Skip on Windows, as the pipe prefix is required, and makes it an absolute path.
    it('throws if unix:// is followed by a relative path', { skip: process.platform === 'win32' }, async () => {
      const path = `unix://${getRelativePath()}`;
      await Assert.rejects(async () => {
        await runTest(path);
      }, /must specify an absolute path/);
    });
  });

  describe('Maximum Message Size', () => {
    const protoFile = Path.join(__dirname, 'proto', 'echo_service.proto');
    const { EchoService } = loadProtoFile(protoFile);

    async function runTest (settings) {
      const barrier = new Barrier();
      const server = new Server(settings);

      server.addService(EchoService.service, {
        echo (call, callback) {
          callback(null, { value: call.request.value });
        },
        echoBidiStream (stream) {
          stream.on('data', (chunk) => {
            stream.write({ value: chunk.value });
          });
        }
      });

      const port = await server.bind('localhost:0', serverInsecureCreds);
      server.start();
      const client = new EchoService(`localhost:${port}`, clientInsecureCreds);

      // Test a unary send/receive.
      client.echo({ value: 'a' }, (error, response) => {
        Assert.strictEqual(error.code, Grpc.status.RESOURCE_EXHAUSTED);
        if (settings['grpc.max_receive_message_length']) {
          Assert.strictEqual(error.details, 'Received message larger than max (8 vs. 1)');
        } else {
          Assert.strictEqual(error.details, 'Sent message larger than max (8 vs. 1)');
        }
        Assert.strictEqual(response, undefined);

        // Test a streaming send/receive.
        const call = client.echoBidiStream();
        call.on('data', () => { throw new Error('should not happen'); });
        call.on('error', (error) => {
          Assert.strictEqual(error.code, Grpc.status.RESOURCE_EXHAUSTED);
          if (settings['grpc.max_receive_message_length']) {
            Assert.strictEqual(error.details, 'Received message larger than max (9 vs. 1)');
          } else {
            Assert.strictEqual(error.details, 'Sent message larger than max (9 vs. 1)');
          }
          client.close();
          server.forceShutdown();
          barrier.pass();
        });

        call.write({ value: 'bc' });
      });

      return barrier;
    }

    it('enforces maximum received message length', async () => {
      await runTest({ 'grpc.max_receive_message_length': 1 });
    });

    it('enforces maximum sent message length', async () => {
      await runTest({ 'grpc.max_send_message_length': 1 });
    });
  });


  describe('No stream end events on error', () => {
    const protoFile = Path.join(__dirname, 'proto', 'echo_service.proto');
    const { EchoService } = loadProtoFile(protoFile);

    async function getTestSetup () {
      const barrier = new Barrier();
      const server = new Server();

      server.addService(EchoService.service, {
        echoClientStream (stream, callback) {
          stream.on('end', () => {
            throw new Error('should not happen');
          });

          stream.on('data', (chunk) => {
            throw new Error('client-stream-error');
          });
        },
        echoBidiStream (stream) {
          stream.on('end', () => {
            throw new Error('should not happen');
          });

          stream.on('data', (chunk) => {
            throw new Error('bidi-stream-error');
          });
        }
      });

      const port = await server.bind('localhost:0', serverInsecureCreds);
      server.start();
      const client = new EchoService(`localhost:${port}`, clientInsecureCreds);
      return { barrier, client, server };
    }

    it('does not emit end event on server for client stream', async () => {
      const { barrier, client, server } = await getTestSetup();
      const stream = client.echoClientStream((err, data) => {
        client.close();
        server.forceShutdown();
        Assert.strictEqual(err.details, 'client-stream-error');
        Assert.strictEqual(data, undefined);
        barrier.pass();
      });

      stream.write({});
      return barrier;
    });

    it('does not emit end event on server for bidi stream', async () => {
      const { barrier, client, server } = await getTestSetup();
      const stream = client.echoBidiStream();

      stream.on('error', (err) => {
        client.close();
        server.forceShutdown();
        Assert.strictEqual(err.details, 'bidi-stream-error');
        barrier.pass();
      });

      stream.write({});
      return barrier;
    });
  });
});

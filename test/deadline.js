'use strict';
const Assert = require('assert');
const Path = require('path');
const Barrier = require('cb-barrier');
const Lab = require('lab');
const Grpc = require('@grpc/grpc-js');
const { Server, ServerCredentials } = require('../lib');
const { loadProtoFile } = require('./common');

// Test shortcuts
const lab = exports.lab = Lab.script();
const { describe, it, before, after } = lab;


const clientInsecureCreds = Grpc.credentials.createInsecure();
const serverInsecureCreds = ServerCredentials.createInsecure();


describe('Deadlines', () => {
  let server;
  let client;

  before(async () => {
    const proto = loadProtoFile(Path.join(__dirname, 'proto', 'test_service.proto'));
    const TestServiceClient = proto.TestService;

    server = new Server();
    server.addService(proto.TestService.service, {
      unary (call, cb) {
        call.on('cancelled', (reason) => {
          Assert.strictEqual(reason, 'deadline');
        });

        setTimeout(() => {
          cb(null, {});
        }, 2000);
      }
    });

    const port = await server.bind('localhost:0', serverInsecureCreds);
    client = new TestServiceClient(`localhost:${port}`, clientInsecureCreds);
    server.start();
  });

  after(() => {
    server.tryShutdown();
  });

  it('works with deadlines', () => {
    const barrier = new Barrier();
    const metadata = new Grpc.Metadata();
    const {
      path,
      requestSerialize: serialize,
      responseDeserialize: deserialize
    } = client.unary;

    metadata.set('grpc-timeout', '100m');
    client.makeUnaryRequest(path, serialize, deserialize, {}, metadata, {}, (error, response) => {
      Assert.strictEqual(error.code, Grpc.status.DEADLINE_EXCEEDED);
      Assert.strictEqual(error.details, 'Deadline exceeded');
      Assert.strictEqual(error.message, 'Deadline exceeded');
      barrier.pass();
    });

    return barrier;
  });

  it('rejects invalid deadline', () => {
    const barrier = new Barrier();
    const metadata = new Grpc.Metadata();
    const {
      path,
      requestSerialize: serialize,
      responseDeserialize: deserialize
    } = client.unary;

    metadata.set('grpc-timeout', 'Infinity');
    client.makeUnaryRequest(path, serialize, deserialize, {}, metadata, {}, (error, response) => {
      Assert.strictEqual(error.code, Grpc.status.OUT_OF_RANGE);
      Assert.strictEqual(error.details, 'Invalid deadline');
      Assert.strictEqual(error.message, 'Invalid deadline');
      barrier.pass();
    });

    return barrier;
  });
});


describe('Cancellation', () => {
  let server;
  let client;
  let inHandler = false;
  let cancelledInServer = false;

  before(async () => {
    const proto = loadProtoFile(Path.join(__dirname, 'proto', 'test_service.proto'));
    const TestServiceClient = proto.TestService;

    server = new Server();
    server.addService(proto.TestService.service, {
      serverStream (stream) {
        inHandler = true;
        stream.on('cancelled', (reason) => {
          Assert.strictEqual(reason, 'cancelled');
          stream.write({});
          stream.end();
          cancelledInServer = true;
        });
      }
    });

    const port = await server.bind('localhost:0', serverInsecureCreds);
    client = new TestServiceClient(`localhost:${port}`, clientInsecureCreds);
    server.start();
  });

  after(() => {
    server.tryShutdown();
  });

  it('handles requests cancelled by the client', () => {
    const barrier = new Barrier();
    const call = client.serverStream({});

    call.on('data', Assert.ifError);
    call.on('error', (error) => {
      Assert.strictEqual(error.code, Grpc.status.CANCELLED);
      Assert.strictEqual(error.details, 'Cancelled on client');
      Assert.strictEqual(error.message, 'Cancelled on client');
      waitForServerCancel();
    });

    function waitForHandler () {
      if (inHandler === true) {
        call.cancel();
        return;
      }

      setImmediate(waitForHandler);
    }

    function waitForServerCancel () {
      if (cancelledInServer === true) {
        barrier.pass();
        return;
      }

      setImmediate(waitForServerCancel);
    }

    waitForHandler();
    return barrier;
  });
});

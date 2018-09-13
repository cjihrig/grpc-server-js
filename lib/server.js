'use strict';
const Http2 = require('http2');
const { URL } = require('url');
const { status } = require('@grpc/grpc-js');
const { ServerCall } = require('./server-call');
const { ServerCredentials } = require('./server-credentials');
const { ServerDuplexStream } = require('./server-duplex-stream');
const { ServerReadableStream } = require('./server-readable-stream');
const { ServerUnaryCall } = require('./server-unary-call');
const { ServerWritableStream } = require('./server-writable-stream');
const kHandlers = Symbol('handlers');
const kServer = Symbol('server');
const kStarted = Symbol('started');


const unimplementedStatusResponse = {
  code: status.UNIMPLEMENTED,
  details: 'The server does not implement this method'
};


const defaultHandler = {
  unary: function (call, callback) {
    callback(unimplementedStatusResponse);
  },
  clientStream: function (call, callback) {
    callback(unimplementedStatusResponse);
  },
  serverStream: function (call) {
    call.emit('error', unimplementedStatusResponse);
  },
  bidi: function (call) {
    call.emit('error', unimplementedStatusResponse);
  }
};


function noop () {}


class Server {
  constructor (options) {
    this[kServer] = null;
    this[kHandlers] = new Map();
    this[kStarted] = false;
  }

  async bind (port, creds) {  // eslint-disable-line require-await
    if (this[kStarted] === true) {
      throw new Error('server is already started');
    }

    if (creds === null || typeof creds !== 'object') {
      creds = ServerCredentials.createInsecure();
    }

    const { secure } = creds;

    if (typeof port === 'string') {
      const url = new URL(`http://${port}`);
      port = { host: url.hostname, port: url.port };
    }

    if (secure) {
      this[kServer] = Http2.createSecureServer(creds.settings);
    } else {
      this[kServer] = Http2.createServer();
    }

    setupHandlers(this);

    this[kServer].on('error', (err) => {
      // TODO: What to do here?
      console.error(err);
    });

    return new Promise((resolve, reject) => {
      this[kServer].listen(port, () => {
        resolve(this[kServer].address().port);
      });
    });
  }

  start () {
    if (this[kServer] === null || this[kServer].listening !== true) {
      throw new Error('server must be bound in order to start');
    }

    if (this[kStarted] === true) {
      throw new Error('server is already started');
    }

    this[kStarted] = true;
  }

  addService (service, implementation) {
    if (this[kStarted] === true) {
      throw new Error('Can\'t add a service to a started server.');
    }

    if (service === null || typeof service !== 'object' ||
        implementation === null || typeof implementation !== 'object') {
      throw new Error('addService requires two objects as arguments');
    }

    const serviceKeys = Object.keys(service);

    if (serviceKeys.length === 0) {
      throw new Error('Cannot add an empty service to a server');
    }

    serviceKeys.forEach((name) => {
      const attrs = service[name];
      let methodType;

      if (attrs.requestStream) {
        if (attrs.responseStream) {
          methodType = 'bidi';
        } else {
          methodType = 'clientStream';
        }
      } else {
        if (attrs.responseStream) {
          methodType = 'serverStream';
        } else {
          methodType = 'unary';
        }
      }

      const implFn = implementation[name] || implementation[attrs.originalName];
      let impl;

      if (implFn !== undefined) {
        impl = implFn.bind(implementation);
      } else {
        impl = defaultHandler[methodType];
      }

      const success = this.register(attrs.path, impl, attrs.responseSerialize,
        attrs.requestDeserialize, methodType);

      if (success === false) {
        throw new Error(`Method handler for ${attrs.path} already provided.`);
      }
    });
  }

  register (name, handler, serialize, deserialize, type) {
    if (this[kHandlers].has(name)) {
      return false;
    }

    this[kHandlers].set(name, { func: handler, serialize, deserialize, type });
    return true;
  }

  tryShutdown (callback) {
    callback = typeof callback === 'function' ? callback : noop;

    if (this[kServer] === null) {
      callback(new Error('server is not running'));
      return;
    }

    this[kServer].close((err) => {
      this[kStarted] = false;
      callback(err);
    });
  }

  forceShutdown () {  // eslint-disable-line class-methods-use-this
    throw new Error('not implemented');
  }
}

module.exports = { Server };


const handlerTypes = {
  unary: handleUnary,
  clientStream: handleClientStreaming,
  serverStream: handleServerStreaming,
  bidi: handleBidiStreaming
};


function setupHandlers (grpcServer) {
  grpcServer[kServer].on('stream', (stream, headers) => {
    if (grpcServer[kStarted] !== true) {
      stream.end();
      return;
    }

    const call = new ServerCall(stream);

    try {
      const path = headers[Http2.constants.HTTP2_HEADER_PATH];
      const handler = grpcServer[kHandlers].get(path);

      if (handler === undefined) {
        throw new Error('no matching handler');
      }

      const metadata = call.receiveMetadata(headers);

      call.handler = handler;
      handlerTypes[handler.type](call, handler, metadata);
    } catch (err) {
      call.sendError(err, status.INTERNAL);
    }
  });
}


async function handleUnary (call, handler, metadata) {
  const emitter = new ServerUnaryCall(call.stream, metadata);
  const request = await call.receiveUnaryMessage();

  if (request === undefined) {
    return;
  }

  emitter.request = request;
  handler.func(emitter, (err, value, trailer, flags) => {
    if (err) {
      if (trailer) {
        err.metadata = trailer;
      }

      call.sendError(err);
      return;
    }

    call.sendUnaryMessage(value, handler.serialize, trailer, flags);
  });
}


function handleClientStreaming (call, handler, metadata) {
  const stream = call.stream;
  const serverStream = new ServerReadableStream(stream, metadata,
    handler.deserialize);

  function respond (err, value, trailer, flags) {
    serverStream.terminate();

    if (err) {
      if (trailer) {
        err.metadata = trailer;
      }

      call.sendError(err);
      return;
    }

    call.sendUnaryMessage(value, handler.serialize, trailer, flags);
  }

  serverStream.on('error', respond);
  handler.func(serverStream, respond);
}


async function handleServerStreaming (call, handler, metadata) {
  const request = await call.receiveUnaryMessage();

  if (request === undefined) {
    return;
  }

  const stream = new ServerWritableStream(call.stream, metadata,
    handler.serialize);

  stream.request = request;
  handler.func(stream);
}


function handleBidiStreaming (call, handler, metadata) {
  const stream = new ServerDuplexStream(call.stream, metadata,
    handler.serialize, handler.deserialize);

  handler.func(stream);
}

'use strict';
const Http2 = require('http2');
const { URL } = require('url');
const { status, ServerCredentials } = require('@grpc/grpc-js');
const {
  ServerDuplexStream,
  ServerReadableStream,
  ServerUnaryCall,
  ServerWritableStream
} = require('./handler');
const { ServerCall } = require('./server-call');
const kHandlers = Symbol('handlers');
const kServer = Symbol('server');
const kStarted = Symbol('started');
const kUnaryHandlerType = 0;
const kClientStreamHandlerType = 1;
const kServerStreamHandlerType = 2;
const kBidiHandlerType = 3;
const { HTTP2_HEADER_PATH } = Http2.constants;


const unimplementedStatusResponse = {
  code: status.UNIMPLEMENTED,
  details: 'The server does not implement this method'
};


const defaultHandler = [
  function unary (call, callback) {
    callback(unimplementedStatusResponse);
  },
  function clientStream (call, callback) {
    callback(unimplementedStatusResponse);
  },
  function serverStream (call) {
    call.emit('error', unimplementedStatusResponse);
  },
  function bidi (call) {
    call.emit('error', unimplementedStatusResponse);
  }
];


function noop () {}


class Server {
  constructor () {
    this[kServer] = null;
    this[kHandlers] = new Map();
    this[kStarted] = false;
  }

  bind (port, creds) {
    if (this[kStarted] === true) {
      throw new Error('server is already started');
    }

    if (typeof port === 'number') {
      port = `localhost:${port}`;
    }

    if (creds === null || typeof creds !== 'object') {
      creds = ServerCredentials.createInsecure();
    }

    return new Promise((resolve, reject) => {
      this.bindAsync(port, creds, (err, boundPort) => {
        if (err) {
          reject(err);
        }

        resolve(boundPort);
      });
    });
  }

  bindAsync (port, creds, callback) {
    if (this[kStarted] === true) {
      throw new Error('server is already started');
    }

    if (typeof port !== 'string') {
      throw new TypeError('port must be a string');
    }

    if (creds === null || typeof creds !== 'object') {
      throw new TypeError('creds must be an object');
    }

    if (typeof callback !== 'function') {
      throw new TypeError('callback must be a function');
    }

    const url = new URL(`http://${port}`);
    const options = { host: url.hostname, port: +url.port };

    if (creds._isSecure()) {
      this[kServer] = Http2.createSecureServer(creds._getSettings());
    } else {
      this[kServer] = Http2.createServer();
    }

    setupHandlers(this);

    function onError (err) {
      callback(err, -1);
    }

    this[kServer].once('error', onError);
    this[kServer].listen(options, () => {
      const server = this[kServer];
      const port = server.address().port;

      server.removeListener('error', onError);
      callback(null, port);
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
          methodType = kBidiHandlerType;
        } else {
          methodType = kClientStreamHandlerType;
        }
      } else {
        if (attrs.responseStream) {
          methodType = kServerStreamHandlerType;
        } else {
          methodType = kUnaryHandlerType;
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

  forceShutdown () {    // eslint-disable-line class-methods-use-this
    throw new Error('not implemented');
  }

  addHttp2Port () {     // eslint-disable-line class-methods-use-this
    throw new Error('not implemented');
  }

  addProtoService () {  // eslint-disable-line class-methods-use-this
    throw new Error('not implemented. use addService() instead');
  }
}

module.exports = { Server };


const handlerTypes = [
  handleUnary,
  handleClientStreaming,
  handleServerStreaming,
  handleBidiStreaming
];


function setupHandlers (grpcServer) {
  grpcServer[kServer].on('stream', (stream, headers) => {
    if (grpcServer[kStarted] !== true) {
      stream.end();
      return;
    }

    const call = new ServerCall(stream);

    try {
      const path = headers[HTTP2_HEADER_PATH];
      const handler = grpcServer[kHandlers].get(path);

      if (handler === undefined) {
        return call.sendError(unimplementedStatusResponse);
      }

      const metadata = call.receiveMetadata(headers);

      call.handler = handler;
      handlerTypes[handler.type](call, handler, metadata);
    } catch (err) {
      call.sendError(err, status.INTERNAL);
    }
  });
}


function handleUnary (call, handler, metadata) {
  call.receiveUnaryMessage((err, request) => {
    if (err !== null || call.cancelled === true) {
      return;
    }

    const emitter = new ServerUnaryCall(call, metadata);

    emitter.request = request;
    handler.func(emitter, call.sendUnaryMessage.bind(call));
  });
}


function handleClientStreaming (call, handler, metadata) {
  const stream = new ServerReadableStream(call, metadata);

  function respond (err, value, trailer, flags) {
    stream._terminate();
    call.sendUnaryMessage(err, value, trailer, flags);
  }

  if (call.cancelled === true) {
    return;
  }

  stream.on('error', respond);
  handler.func(stream, respond);
}


function handleServerStreaming (call, handler, metadata) {
  call.receiveUnaryMessage((err, request) => {
    if (err !== null || call.cancelled === true) {
      return;
    }

    const stream = new ServerWritableStream(call, metadata);

    stream.request = request;
    handler.func(stream);
  });
}


function handleBidiStreaming (call, handler, metadata) {
  const stream = new ServerDuplexStream(call, metadata);

  if (call.cancelled === true) {
    return;
  }

  handler.func(stream);
}

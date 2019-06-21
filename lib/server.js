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
const { ServerSession } = require('./server-session');
const kHandlers = Symbol('handlers');
const kServer = Symbol('server');
const kStarted = Symbol('started');
const kOptions = Symbol('options');
const kSessions = Symbol('sessions');
const kSessionOptions = Symbol('sessionOptions');
const kUnaryHandlerType = 0;
const kClientStreamHandlerType = 1;
const kServerStreamHandlerType = 2;
const kBidiHandlerType = 3;
const kValidContentTypePrefix = 'application/grpc';
const {
  HTTP2_HEADER_CONTENT_TYPE,
  HTTP2_HEADER_STATUS,
  HTTP2_HEADER_PATH,
  HTTP_STATUS_UNSUPPORTED_MEDIA_TYPE,
  NGHTTP2_CANCEL
} = Http2.constants;

const unimplementedStatusResponse = {
  code: status.UNIMPLEMENTED,
  details: 'The server does not implement this method'
};

const unsuportedMediaTypeResponse = {
  [HTTP2_HEADER_STATUS]: HTTP_STATUS_UNSUPPORTED_MEDIA_TYPE
};
const unsuportedMediaTypeResponseOptions = { endStream: true };

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

const defaultHttp2Settings = Http2.getDefaultSettings();
const defaultServerOptions = {
  'grpc.http2.max_frame_size': defaultHttp2Settings.maxFrameSize,
  'grpc.keepalive_time_ms': 7200000,  // 2 hours in ms (spec default).
  'grpc.keepalive_timeout_ms': 20000  // 20 seconds in ms (spec default).
};


class Server {
  constructor (options = {}) {
    if (options === null || typeof options !== 'object') {
      throw new TypeError('options must be an object');
    }

    this[kServer] = null;
    this[kHandlers] = new Map();
    this[kSessions] = new Set();
    this[kStarted] = false;
    this[kOptions] = { ...defaultServerOptions, ...options };
    this[kSessionOptions] = {
      keepaliveTimeMs: this[kOptions]['grpc.keepalive_time_ms'],
      keepaliveTimeoutMs: this[kOptions]['grpc.keepalive_timeout_ms']
    };
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
    const http2ServerOptions = {
      maxFrameSize: this[kOptions]['grpc.http2.max_frame_size']
    };

    if (creds._isSecure()) {
      this[kServer] = Http2.createSecureServer({
        ...http2ServerOptions,
        ...creds._getSettings()
      });
    } else {
      this[kServer] = Http2.createServer(http2ServerOptions);
    }

    this[kServer].timeout = 0;
    setupHandlers(this);

    function onError (err) {
      this[kServer] = null;
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

    let pendingChecks = 0;
    let callbackError = null;

    function maybeCallback (err) {
      if (err) {
        callbackError = err;
      }

      pendingChecks--;

      if (pendingChecks === 0) {
        callback(callbackError);
      }
    }

    // Close the server if necessary.
    this[kStarted] = false;

    if (this[kServer] !== null && this[kServer].listening === true) {
      pendingChecks++;
      this[kServer].close(maybeCallback);
    }

    // If any sessions are active, close them gracefully.
    pendingChecks += this[kSessions].size;
    this[kSessions].forEach((session) => {
      session.close(maybeCallback);
    });

    // If the server is closed and there are no active sessions, just call back.
    if (pendingChecks === 0) {
      callback(null);
    }
  }

  forceShutdown () {
    // Close the server if it is still running.
    if (this[kServer] !== null && this[kServer].listening === true) {
      this[kServer].close();
    }

    this[kStarted] = false;

    // Always destroy any available sessions. It's possible that one or more
    // tryShutdown() calls are in progress. Don't wait on them to finish.
    this[kSessions].forEach((session) => {
      session.destroy(NGHTTP2_CANCEL);
    });

    this[kSessions].clear();
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
  const http2Server = grpcServer[kServer];

  http2Server.on('stream', (stream, headers) => {
    const contentType = headers[HTTP2_HEADER_CONTENT_TYPE];

    if (typeof contentType !== 'string' ||
        !contentType.startsWith(kValidContentTypePrefix)) {
      stream.respond(unsuportedMediaTypeResponse,
        unsuportedMediaTypeResponseOptions);
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

  http2Server.on('session', (session) => {
    if (grpcServer[kStarted] !== true) {
      session.destroy();
      return;
    }

    const grpcSession = new ServerSession(session, grpcServer[kSessionOptions]);

    // The client has connected, so begin sending keepalive pings.
    grpcSession.startKeepalivePings();

    grpcServer[kSessions].add(session);
    grpcSession.once('close', () => {
      grpcServer[kSessions].delete(session);
    });
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
    stream.destroy();
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

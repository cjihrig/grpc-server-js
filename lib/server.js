'use strict';
const Http2 = require('http2');
const {
  ServerDuplexStream,
  ServerReadableStream,
  ServerUnaryCall,
  ServerWritableStream
} = require('./handler');
const { parseOptions } = require('./options');
const { ServerCall } = require('./server-call');
const { ServerCredentials } = require('./server-credentials');
const { resolveToListenOptions } = require('./server-resolver');
const { ServerSession } = require('./server-session');
const Status = require('./status');
const kHandlers = Symbol('handlers');
const kServers = Symbol('servers');
const kStarted = Symbol('started');
const kOptions = Symbol('options');
const kSessions = Symbol('sessions');
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
const defaultHttp2Settings = Http2.getDefaultSettings();

const unsuportedMediaTypeResponse = {
  [HTTP2_HEADER_STATUS]: HTTP_STATUS_UNSUPPORTED_MEDIA_TYPE
};
const unsuportedMediaTypeResponseOptions = { endStream: true };

function noop () {}


class Server {
  constructor (options = {}) {
    if (options === null || typeof options !== 'object') {
      throw new TypeError('options must be an object');
    }

    this[kServers] = [];
    this[kHandlers] = new Map();
    this[kSessions] = new Set();
    this[kStarted] = false;
    this[kOptions] = parseOptions(options);
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

    const listenOptions = resolveToListenOptions(port, creds._isSecure());
    const http2ServerOptions = {
      allowHTTP1: false,
      settings: {
        ...defaultHttp2Settings,
        enablePush: false,
        maxFrameSize: this[kOptions].maxFrameSize,
        maxConcurrentStreams: this[kOptions].maxConcurrentStreams
      }
    };

    let server;

    if (creds._isSecure()) {
      server = Http2.createSecureServer({
        ...http2ServerOptions,
        ...creds._getSettings()
      });
    } else {
      server = Http2.createServer(http2ServerOptions);
    }

    server.timeout = 0;
    setupHandlers(this, server);

    function onError (err) {
      callback(err, -1);
    }

    server.once('error', onError);
    server.listen(listenOptions, () => {
      const port = server.address().port;

      server.removeListener('error', onError);
      this[kServers].push(server);
      callback(null, port);
    });
  }

  start () {
    const servers = this[kServers];
    const ready = servers.length > 0 && servers.every((server) => {
      return server.listening === true;
    });

    if (!ready) {
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
        impl = getDefaultHandler(methodType, name);
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

    this[kHandlers].set(name, {
      func: handler,
      serialize,
      deserialize,
      type,
      path: name
    });

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
    this[kServers].forEach((server) => {
      if (server.listening === true) {
        pendingChecks++;
        server.close(maybeCallback);
      }
    });

    // If any sessions are active, close them gracefully.
    this[kSessions].forEach((session) => {
      if (!session.closed) {
        session.close(maybeCallback);
        pendingChecks++;
      }
    });

    // If the server is closed and there are no active sessions, just call back.
    if (pendingChecks === 0) {
      callback(null);
    }
  }

  forceShutdown () {
    // Close the server if it is still running.
    this[kServers].forEach((server) => {
      if (server.listening === true) {
        server.close();
      }
    });

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


function setupHandlers (grpcServer, http2Server) {
  http2Server.on('stream', (stream, headers) => {
    const contentType = headers[HTTP2_HEADER_CONTENT_TYPE];

    if (typeof contentType !== 'string' ||
        !contentType.startsWith(kValidContentTypePrefix)) {
      stream.respond(unsuportedMediaTypeResponse,
        unsuportedMediaTypeResponseOptions);
      return;
    }

    const call = new ServerCall(stream, grpcServer[kOptions]);

    try {
      const path = headers[HTTP2_HEADER_PATH];
      const handler = grpcServer[kHandlers].get(path);

      if (handler === undefined) {
        return call.sendError(getUnimplementedStatusResponse(path));
      }

      const metadata = call.receiveMetadata(headers);

      call.handler = handler;
      handlerTypes[handler.type](call, handler, metadata);
    } catch (err) {
      call.sendError(err, Status.INTERNAL);
    }
  });

  http2Server.on('session', (session) => {
    if (grpcServer[kStarted] !== true) {
      session.destroy();
      return;
    }

    const grpcSession = new ServerSession(session, grpcServer[kOptions]);

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


function getUnimplementedStatusResponse (path) {
  return {
    code: Status.UNIMPLEMENTED,
    details: `The server does not implement the method ${path}`
  };
}


function getDefaultHandler (handlerType, callName) {
  const unimplementedStatusResponse = getUnimplementedStatusResponse(callName);

  switch (handlerType) {
    case 0 : // Unary
      return function unary (call, callback) {
        callback(unimplementedStatusResponse);
      };
    case 1 : // Client stream
      return function clientStream (call, callback) {
        callback(unimplementedStatusResponse);
      };
    case 2 : // Server stream
      return function serverStream (call) {
        call.emit('error', unimplementedStatusResponse);
      };
    case 3 : // Bidi stream
      return function bidi (call) {
        call.emit('error', unimplementedStatusResponse);
      };
    default :
      throw new Error(`Invalid handler type ${handlerType}`);
  }
}

'use strict';
const Http2 = require('http2');
const { URL } = require('url');
const { Metadata, status } = require('@grpc/grpc-js');
const { CompressionFilter } =
  require('@grpc/grpc-js/build/src/compression-filter');
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

    try {
      const path = headers[Http2.constants.HTTP2_HEADER_PATH];
      const handler = grpcServer[kHandlers].get(path);

      if (handler === undefined) {
        throw new Error('no matching handler');
      }

      // TODO: Do this differently.
      // Deleting headers is probably not the best solution here, and likely
      // hurts performance. However, fromHttp2Headers() throws otherwise.
      delete headers[Http2.constants.HTTP2_HEADER_SCHEME];
      delete headers[Http2.constants.HTTP2_HEADER_PATH];
      delete headers[Http2.constants.HTTP2_HEADER_METHOD];
      delete headers[Http2.constants.HTTP2_HEADER_AUTHORITY];
      const metadata = Metadata.fromHttp2Headers(headers);
      // console.log(metadata);
      // console.log('************');
      // metadata = await filter.receiveMetadata(Promise.resolve(metadata));
      // console.log(metadata);

      // TODO: Create `call` here instead of passing the HTTP2 stream?
      handlerTypes[handler.type](stream, handler, metadata);
    } catch (err) {
      err.code = status.INTERNAL;
      handleError(stream, err);
    }
  });
}


function handleUnary (stream, handler, metadata) {
  const filter = new CompressionFilter();
  const chunks = [];
  let totalLength = 0;

  stream.on('data', (data) => {
    chunks.push(data);
    totalLength += data.byteLength;
  });

  stream.on('end', async () => {
    const requestBytes = Buffer.concat(chunks, totalLength);
    const receivedMessage = await filter.receiveMessage(requestBytes);

    let request;

    try {
      request = handler.deserialize(receivedMessage);
    } catch (err) {
      err.code = status.INTERNAL;
      handleError(stream, err);
      return;
    }

    const emitter = new ServerUnaryCall(stream, metadata);

    emitter.request = request;
    handler.func(emitter, (err, value, trailer, flags) => {
      if (err) {
        if (trailer) {
          err.metadata = trailer;
        }

        handleError(stream, err);
        return;
      }

      sendUnaryResponse(stream, value, handler.serialize, trailer, flags);
    });
  });
}


function handleClientStreaming (stream, handler, metadata) {
  const serverStream = new ServerReadableStream(stream, metadata,
    handler.deserialize);

  function respond (err, value, trailer, flags) {
    if (stream.headersSent === true) {
      return;
    }

    serverStream.terminate();

    if (err) {
      if (trailer) {
        err.metadata = trailer;
      }

      handleError(stream, err);
      return;
    }

    sendUnaryResponse(stream, value, handler.serialize, trailer, flags);
  }

  serverStream.on('error', respond);
  handler.func(serverStream, respond);
}


function handleServerStreaming (stream, handler, metadata) {
  const chunks = [];
  let totalLength = 0;

  stream.on('data', (data) => {
    chunks.push(data);
    totalLength += data.byteLength;
  });

  stream.on('end', () => {
    const requestBytes = Buffer.concat(chunks, totalLength);
    let request;

    try {
      request = handler.deserialize(requestBytes.slice(5));
    } catch (err) {
      err.code = status.INTERNAL;
      handleError(stream, err);
      return;
    }

    const serverStream = new ServerWritableStream(stream, metadata,
      handler.serialize);

    serverStream.request = request;
    handler.func(serverStream);
  });
}


function handleBidiStreaming (stream, handler, metadata) {
  const serverStream = new ServerDuplexStream(stream, metadata,
    handler.serialize, handler.deserialize);

  handler.func(serverStream);
}


const defaultResponseHeaders = {
  ':status': 200,
  'content-type': 'application/grpc+proto'
};
const defaultResponseOptions = { waitForTrailers: true };


function sendUnaryResponse (stream, value, serialize, metadata, flags) {
  let response;

  try {
    const messageBuffer = serialize(value);

    response = Buffer.allocUnsafe(messageBuffer.byteLength + 5);
    response.writeUInt8(0, 0);
    response.writeUInt32BE(messageBuffer.byteLength, 1);
    messageBuffer.copy(response, 5);
  } catch (err) {
    err.code = status.INTERNAL;
    handleError(stream, err);
    return;
  }

  stream.once('wantTrailers', () => {
    let trailers = {
      'grpc-status': 0,
      'grpc-message': 'OK',
      'content-type': 'application/grpc+proto'
    };

    if (metadata) {
      trailers = Object.assign(metadata.toHttp2Headers(), trailers);
    }

    stream.sendTrailers(trailers);
  });

  stream.respond(defaultResponseHeaders, defaultResponseOptions);
  stream.end(response);
}


function handleError (stream, error) {
  let code = status.UNKNOWN;
  let details = 'Unknown Error';
  let metadata;

  if (error.hasOwnProperty('message')) {
    details = error.message;
  }

  if (error.hasOwnProperty('code') && Number.isInteger(error.code)) {
    code = error.code;

    if (error.hasOwnProperty('details')) {
      details = error.details;
    }
  }

  if (error.hasOwnProperty('metadata')) {
    metadata = error.metadata;
  }

  stream.once('wantTrailers', () => {
    let trailers = {
      'grpc-status': code,
      'grpc-message': details,
      'content-type': 'application/grpc+proto'
    };

    if (metadata) {
      trailers = Object.assign(metadata.toHttp2Headers(), trailers);
    }

    stream.sendTrailers(trailers);
  });

  stream.respond(defaultResponseHeaders, defaultResponseOptions);
  stream.end();
}

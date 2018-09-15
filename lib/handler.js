'use strict';
const EventEmitter = require('events');
const { Duplex, Readable, Writable } = require('stream');
const { Metadata, status: Status } = require('@grpc/grpc-js');
const { StreamDecoder } = require('./stream-decoder');
const kCall = Symbol('call');


class ServerUnaryCall extends EventEmitter {
  constructor (call, metadata) {
    super();
    setUpHandler(this, call, metadata);
    this.request = undefined;
  }
}

ServerUnaryCall.prototype.sendMetadata = sendMetadata;
ServerUnaryCall.prototype.getPeer = getPeer;


class ServerReadableStream extends Readable {
  constructor (call, metadata) {
    super({ objectMode: true });
    setUpHandler(this, call, metadata);
    setUpReadable(this);
  }

  _read (size) {
    if (this.finished) {
      this.push(null);
      return;
    }

    this.reading = true;
  }

  terminate () {
    this.finished = true;
    this.on('data', noop);
  }

  deserialize (input) {
    if (input === null || input === undefined) {
      return null;
    }

    return this[kCall].handler.deserialize(input);
  }
}

ServerReadableStream.prototype.sendMetadata = sendMetadata;
ServerReadableStream.prototype.getPeer = getPeer;


class ServerWritableStream extends Writable {
  constructor (call, metadata) {
    super({ objectMode: true });
    setUpHandler(this, call, metadata);
    setUpWritable(this);
    this.request = undefined;
  }

  async _write (chunk, encoding, callback) {
    try {
      this.outstandingWrites++;
      const response = await this[kCall].serializeMessage(chunk);
      this.call.write(response);
      this.outstandingWrites--;
    } catch (err) {
      this.outstandingWrites = 0;
      err.code = Status.INTERNAL;
      this.emit('error', err);
    }

    callback(null);
  }

  end (metadata) {
    // If there are still writes pending, do not end the HTTP2 stream.
    if (this.outstandingWrites > 0) {
      setImmediate(this.end.bind(this), metadata);
      return;
    }

    if (metadata) {
      this.status.metadata = metadata;
    }

    this.call.end();
    Writable.prototype.end.call(this);
  }

  serialize (input) {
    if (input === null || input === undefined) {
      return null;
    }

    return this[kCall].handler.serialize(input);
  }
}

ServerWritableStream.prototype.sendMetadata = sendMetadata;
ServerWritableStream.prototype.getPeer = getPeer;


class ServerDuplexStream extends Duplex {
  constructor (call, metadata) {
    super({ objectMode: true });
    setUpHandler(this, call, metadata);
    setUpReadable(this);
    setUpWritable(this);
  }
}

ServerDuplexStream.prototype.sendMetadata = sendMetadata;
ServerDuplexStream.prototype.getPeer = getPeer;
ServerDuplexStream.prototype._read = ServerReadableStream.prototype._read;
ServerDuplexStream.prototype._write = ServerWritableStream.prototype._write;
ServerDuplexStream.prototype.end = ServerWritableStream.prototype.end;
ServerDuplexStream.prototype.serialize =
  ServerWritableStream.prototype.serialize;
ServerDuplexStream.prototype.deserialize =
  ServerReadableStream.prototype.deserialize;
ServerDuplexStream.prototype.terminate =
  ServerReadableStream.prototype.terminate;


function noop () {}


function sendMetadata (responseMetadata) {
  // TODO: Implement this. See grpc-native-core/src/server.js
  throw new Error('not implemented');
}


function getPeer () {
  // TODO: Implement this. See grpc-native-core/src/server.js
  throw new Error('not implemented');
}


function setUpHandler (handler, call, metadata) {
  handler[kCall] = call;
  handler.call = call.stream;
  handler.metadata = metadata;
  handler.cancelled = false;
  handler.cancelledReason = null;

  call.once('cancelled', (reason) => {
    handler.cancelled = true;
    handler.cancelledReason = reason;
    handler.emit('cancelled', reason);
  });
}


function setUpReadable (stream) {
  stream.finished = false;
  stream.reading = false;

  stream.once('cancelled', () => {
    stream.terminate();
  });

  //
  stream.decoder = new StreamDecoder();

  stream.call.on('data', (data) => {
    stream.decoder.write(data);
  });

  stream.call.once('end', () => {
    stream.decoder.end();
  });

  stream.decoder.on('message', async (bytes) => {
    if (bytes === null) {
      stream.reading = false;
      stream.push(null);
      return;
    }

    try {
      const message = await stream[kCall].deserializeMessage(bytes);

      stream.push(message);
    } catch (err) {
      err.code = Status.INTERNAL;
      stream.emit('error', err);
    }
  });
}


function setUpWritable (stream) {
  stream.outstandingWrites = 0;

  stream.status = {
    code: Status.OK,
    details: 'OK',
    metadata: new Metadata()
  };

  // TODO: Need to clear deadline if it is set. The unary response already
  // does it, but the streaming response does not.

  // TODO: Need to handle cancelled requests. The unary response already does
  // it, but the streaming response does not.

  stream.call.respond({
    ':status': 200,
    'content-type': 'application/grpc+proto'
  }, { waitForTrailers: true });

  stream.call.once('wantTrailers', () => {
    const trailers = Object.assign(stream.status.metadata.toHttp2Headers(), {
      'grpc-status': stream.status.code,
      'grpc-message': stream.status.details,
      'content-type': 'application/grpc+proto'
    });

    stream.call.sendTrailers(trailers);
  });

  stream.on('error', (err) => {
    let code = Status.UNKNOWN;
    let details = 'Unknown Error';
    let metadata;

    if (err.hasOwnProperty('message')) {
      details = err.message;
    }

    if (err.hasOwnProperty('code') && Number.isInteger(err.code)) {
      code = err.code;

      if (err.hasOwnProperty('details')) {
        details = err.details;
      }
    }

    if (err.hasOwnProperty('metadata')) {
      metadata = err.metadata;
    } else {
      metadata = new Metadata();
    }

    stream.status = { code, details, metadata };
    stream.end();
  });
}


module.exports = {
  ServerDuplexStream,
  ServerReadableStream,
  ServerUnaryCall,
  ServerWritableStream
};

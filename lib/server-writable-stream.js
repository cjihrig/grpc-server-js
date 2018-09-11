'use strict';
const { Writable } = require('stream');
const { Metadata, status: Status } = require('@grpc/grpc-js');
const { ServerUnaryCall } = require('./server-unary-call');


class ServerWritableStream extends Writable {
  constructor (call, metadata, serialize) {
    super({ objectMode: true });
    this.call = call;
    this.finished = false;
    setUpWritable(this, serialize);
    this.cancelled = false;
    this.metadata = metadata;
    this.request = undefined;
  }

  _write (chunk, encoding, callback) {
    try {
      const messageBuffer = this.serialize(chunk);
      const response = Buffer.allocUnsafe(messageBuffer.byteLength + 5);

      response.writeUInt8(0, 0);
      response.writeUInt32BE(messageBuffer.byteLength, 1);
      messageBuffer.copy(response, 5);
      this.call.write(response);
    } catch (err) {
      err.code = Status.INTERNAL;
      this.emit('error', err);
    }

    callback(null);
  }
}

ServerWritableStream.prototype.sendMetadata =
  ServerUnaryCall.prototype.sendMetadata;
ServerWritableStream.prototype.getPeer =
  ServerUnaryCall.prototype.getPeer;
ServerWritableStream.prototype.waitForCancel =
  ServerUnaryCall.prototype.waitForCancel;

module.exports = { ServerWritableStream };


function setUpWritable (stream, serialize) {
  stream.finished = false;

  stream.status = {
    code: Status.OK,
    details: 'OK',
    metadata: new Metadata()
  };

  stream.serialize = (input) => {
    if (input === null || input === undefined) {
      return null;
    }

    return serialize(input);
  };

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

  stream.end = function (metadata) {
    if (metadata) {
      stream.status.metadata = metadata;
    }

    this.call.end();
    Writable.prototype.end.call(this);
  };
}

module.exports = { ServerWritableStream, setUpWritable };

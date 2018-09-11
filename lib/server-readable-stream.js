'use strict';
const { Readable } = require('stream');
const { CompressionFilter } =
  require('@grpc/grpc-js/build/src/compression-filter');
const { status: Status } = require('@grpc/grpc-js');
const { ServerUnaryCall } = require('./server-unary-call');
const { StreamDecoder } = require('./stream-decoder');


class ServerReadableStream extends Readable {
  constructor (call, metadata, deserialize) {
    super({ objectMode: true });
    this.call = call;
    setUpReadable(this, deserialize);
    this.cancelled = false;
    this.metadata = metadata;
  }

  _read (size) {
    if (this.finished) {
      this.push(null);
      return;
    }

    this.reading = true;
  }
}

ServerReadableStream.prototype.sendMetadata =
  ServerUnaryCall.prototype.sendMetadata;
ServerReadableStream.prototype.getPeer =
  ServerUnaryCall.prototype.getPeer;
ServerReadableStream.prototype.waitForCancel =
  ServerUnaryCall.prototype.waitForCancel;

module.exports = { ServerReadableStream, setUpReadable };


function noop () {}

function setUpReadable (stream, deserialize) {
  stream.deserialize = (input) => {
    if (input === null || input === undefined) {
      return null;
    }

    return deserialize(input);
  };

  stream.finished = false;
  stream.reading = false;

  stream.terminate = () => {
    stream.finished = true;
    stream.on('data', noop);
  };

  stream.on('cancelled', () => {
    stream.terminate();
  });

  //
  stream.decoder = new StreamDecoder();
  stream.filter = new CompressionFilter();

  stream.call.on('data', (data) => {
    stream.decoder.write(data);
  });

  stream.call.on('end', () => {
    stream.decoder.end();
  });

  stream.call.on('error', (err) => {
    err.code = Status.INTERNAL;
    stream.emit('error', err);
  });

  stream.decoder.on('message', async (bytes) => {
    if (bytes === null) {
      stream.reading = false;
      stream.push(null);
      return;
    }

    try {
      const receivedMessage = await stream.filter.receiveMessage(bytes);
      const message = stream.deserialize(receivedMessage);

      stream.push(message);
    } catch (err) {
      err.code = Status.INTERNAL;
      stream.emit('error', err);
    }
  });
}

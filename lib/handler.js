'use strict';
const EventEmitter = require('events');
const { Duplex, Readable, Writable } = require('stream');
const { status: Status } = require('@grpc/grpc-js');
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
    this.call.resume();
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
      const response = await this[kCall].serializeMessage(chunk);

      if (this[kCall].write(response) === false) {
        this[kCall].once('drain', callback);
        return;
      }
    } catch (err) {
      err.code = Status.INTERNAL;
      this.emit('error', err);
    }

    callback();
  }

  _final (callback) {
    this[kCall].end();
    callback(null);
  }

  end (metadata) {
    if (metadata) {
      this[kCall].status.metadata = metadata;
    }

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
ServerDuplexStream.prototype._final = ServerWritableStream.prototype._final;
ServerDuplexStream.prototype.end = ServerWritableStream.prototype.end;
ServerDuplexStream.prototype.serialize =
  ServerWritableStream.prototype.serialize;
ServerDuplexStream.prototype.deserialize =
  ServerReadableStream.prototype.deserialize;


function sendMetadata (responseMetadata) {
  return this[kCall].sendMetadata(responseMetadata);
}


function getPeer () {
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
  const decoder = new StreamDecoder();

  stream.once('cancelled', () => {
    stream.destroy();
  });

  stream.call.on('data', async (data) => {
    const message = decoder.write(data);

    if (message === null) {
      return;
    }

    try {
      const deserialized = await stream[kCall].deserializeMessage(message);

      if (!stream.push(deserialized)) {
        stream.call.pause();
      }
    } catch (err) {
      err.code = Status.INTERNAL;
      stream.emit('error', err);
    }
  });

  stream.call.once('end', () => {
    stream.push(null);
  });
}


function setUpWritable (stream) {
  stream.on('error', (err) => {
    stream[kCall].sendError(err);
    stream.end();
  });
}


module.exports = {
  ServerDuplexStream,
  ServerReadableStream,
  ServerUnaryCall,
  ServerWritableStream
};

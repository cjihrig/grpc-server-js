'use strict';
const EventEmitter = require('events');
const { Duplex, Readable, Writable } = require('stream');
const { status: Status } = require('@grpc/grpc-js');
const { StreamDecoder } = require('./stream-decoder');
const kCall = Symbol('call');
const kReadableState = Symbol('readableState');
const kReadablePushOrBufferMessage = Symbol('readablePushOrBufferMessage');
const kReadablePushMessage = Symbol('readablePushMessage');


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
    this[kReadableState].canPush = true;
    const { messagesToPush } = this[kReadableState];

    while (messagesToPush.length > 0) {
      const nextMessage = messagesToPush.shift();
      const canPush = this.push(nextMessage);

      if (nextMessage === null || canPush === false) {
        this[kReadableState].canPush = false;
        return;
      }
    }

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
ServerReadableStream.prototype[kReadablePushOrBufferMessage] =
  readablePushOrBufferMessage;
ServerReadableStream.prototype[kReadablePushMessage] = readablePushMessage;


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
ServerDuplexStream.prototype[kReadablePushOrBufferMessage] =
  ServerReadableStream.prototype[kReadablePushOrBufferMessage];
ServerDuplexStream.prototype[kReadablePushMessage] =
  ServerReadableStream.prototype[kReadablePushMessage];


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

  stream[kReadableState] = {
    canPush: false,       // Can data be pushed to the readable stream.
    isPushPending: false, // Is an asynchronous push operation in progress.
    bufferedMessages: [], // Messages that have not been deserialized yet.
    messagesToPush: []   // Deserialized messages not yet pushed to the stream.
  };

  stream.once('cancelled', () => {
    stream.destroy();
  });

  stream.call.on('data', (data) => {
    // It's possible that more than one message arrives in a single 'data'
    // event. pushOrBufferMessage() ensures that only a single message is
    // actually processed at a time, because the deserialization process is
    // asynchronous, and can lead to out of order messages.
    const messages = decoder.write(data);

    for (let i = 0; i < messages.length; i++) {
      stream[kReadablePushOrBufferMessage](messages[i]);
    }
  });

  stream.call.once('end', () => {
    stream[kReadablePushOrBufferMessage](null);
  });
}


function readablePushOrBufferMessage (messageBytes) {
  const { bufferedMessages, isPushPending } = this[kReadableState];

  if (isPushPending === true) {
    bufferedMessages.push(messageBytes);
  } else {
    this[kReadablePushMessage](messageBytes);
  }
}


async function readablePushMessage (messageBytes) {
  const { bufferedMessages, messagesToPush } = this[kReadableState];

  if (messageBytes === null) {
    if (this[kReadableState].canPush === true) {
      this.push(null);
    } else {
      messagesToPush.push(null);
    }

    return;
  }

  this[kReadableState].isPushPending = true;

  try {
    const deserialized = await this[kCall].deserializeMessage(messageBytes);

    if (this[kReadableState].canPush === true) {
      if (!this.push(deserialized)) {
        this[kReadableState].canPush = false;
        this.call.pause();
      }
    } else {
      messagesToPush.push(deserialized);
    }
  } catch (err) {
    // Ignore any remaining messages when errors occur.
    bufferedMessages.length = 0;

    err.code = Status.INTERNAL;
    this.emit('error', err);
  }

  this[kReadableState].isPushPending = false;

  if (bufferedMessages.length > 0) {
    this[kReadablePushMessage](bufferedMessages.shift());
  }
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

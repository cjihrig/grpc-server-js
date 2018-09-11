'use strict';
const { Duplex } = require('stream');
const {
  ServerReadableStream,
  setUpReadable
} = require('./server-readable-stream');
const {
  ServerWritableStream,
  setUpWritable
} = require('./server-writable-stream');


class ServerDuplexStream extends Duplex {
  constructor (call, metadata, serialize, deserialize) {
    super({ objectMode: true });
    this.call = call;
    setUpWritable(this, serialize);
    setUpReadable(this, deserialize);
    this.cancelled = false;
    this.metadata = metadata;
  }
}

ServerDuplexStream.prototype.sendMetadata =
  ServerReadableStream.prototype.sendMetadata;
ServerDuplexStream.prototype.getPeer = ServerReadableStream.prototype.getPeer;
ServerDuplexStream.prototype.waitForCancel =
  ServerReadableStream.prototype.waitForCancel;
ServerDuplexStream.prototype._read = ServerReadableStream.prototype._read;
ServerDuplexStream.prototype._write = ServerWritableStream.prototype._write;

module.exports = { ServerDuplexStream };

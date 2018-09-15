'use strict';
const Zlib = require('zlib');
const kGrpcEncodingHeader = 'grpc-encoding';
const kGrpcAcceptEncodingHeader = 'grpc-accept-encoding';


class CompressionHandler {
  async writeMessage (message, compress) {
    if (compress) {
      message = await this.compressMessage(message);
    }

    const output = Buffer.allocUnsafe(message.byteLength + 5);

    output.writeUInt8(compress ? 1 : 0, 0);
    output.writeUInt32BE(message.byteLength, 1);
    message.copy(output, 5);

    return output;
  }

  async readMessage (data) {
    const compressed = data.readUInt8(1) === 1;
    let message = data.slice(5);

    if (compressed) {
      message = await this.decompressMessage(message);
    }

    return message;
  }
}


class IdentityHandler extends CompressionHandler {
  compressMessage (message) { // eslint-disable-line class-methods-use-this
    throw new Error('Identity encoding does not support compression');
  }

  decompressMessage (message) { // eslint-disable-line class-methods-use-this
    throw new Error('Identity encoding does not support compression');
  }

  // eslint-disable-next-line class-methods-use-this
  writeMessage (message, compress) {
    const output = Buffer.allocUnsafe(message.byteLength + 5);

    // Identity compression messages should be marked as uncompressed.
    output.writeUInt8(0, 0);
    output.writeUInt32BE(message.length, 1);
    message.copy(output, 5);

    return output;
  }
}


class GzipHandler extends CompressionHandler {
  compressMessage (message) { // eslint-disable-line class-methods-use-this
    return new Promise((resolve, reject) => {
      Zlib.gzip(message, (err, output) => {
        if (err) {
          reject(err);
        } else {
          resolve(output);
        }
      });
    });
  }

  decompressMessage (message) { // eslint-disable-line class-methods-use-this
    return new Promise((resolve, reject) => {
      Zlib.unzip(message, (err, output) => {
        if (err) {
          reject(err);
        } else {
          resolve(output);
        }
      });
    });
  }
}


class DeflateHandler extends CompressionHandler {
  compressMessage (message) { // eslint-disable-line class-methods-use-this
    return new Promise((resolve, reject) => {
      Zlib.deflate(message, (err, output) => {
        if (err) {
          reject(err);
        } else {
          resolve(output);
        }
      });
    });
  }

  decompressMessage (message) { // eslint-disable-line class-methods-use-this
    return new Promise((resolve, reject) => {
      Zlib.inflate(message, (err, output) => {
        if (err) {
          reject(err);
        } else {
          resolve(output);
        }
      });
    });
  }
}


function getCompressionHandler (compressionName) {
  if (typeof compressionName !== 'string') {
    throw new Error('Compression method must be a string');
  }

  switch (compressionName) {
    case 'identity' :
      return new IdentityHandler();
    case 'deflate' :
      return new DeflateHandler();
    case 'gzip' :
      return new GzipHandler();
    default :
      throw new Error(`Compression method not supported: ${compressionName}`);
  }
}


class CompressionFilter {
  constructor () {
    this.send = new IdentityHandler();
    this.receive = new IdentityHandler();
  }

  sendMetadata (metadata) { // eslint-disable-line class-methods-use-this
    // TODO: These values shouldn't be hard coded.
    metadata.set(kGrpcEncodingHeader, 'identity');
    metadata.set(kGrpcAcceptEncodingHeader, 'identity,deflate,gzip');

    return metadata;
  }

  receiveMetadata (metadata) {
    const receiveEncoding = metadata.get(kGrpcEncodingHeader);

    if (receiveEncoding.length > 0) {
      const encoding = receiveEncoding[0];

      this.receive = getCompressionHandler(encoding);
    }

    metadata.remove(kGrpcEncodingHeader);
    metadata.remove(kGrpcAcceptEncodingHeader);

    return metadata;
  }

  async serializeMessage (message) { // eslint-disable-line require-await
    // TODO: Add support for flags (compression) later.
    return this.send.writeMessage(message, false);
  }

  async deserializeMessage (message) {  // eslint-disable-line require-await
    return this.receive.readMessage(message);
  }
}

module.exports = { CompressionFilter };

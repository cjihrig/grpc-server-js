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
  constructor () {
    super();
    this.name = 'identity';
  }

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
  constructor () {
    super();
    this.name = 'gzip';
  }

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
  constructor () {
    super();
    this.name = 'deflate';
  }

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


// This class tracks all compression methods supported by a server.
// TODO: Export this class and make it configurable by the Server class.
class CompressionMethodMap {
  constructor () {
    this.default = null;
    this.accepts = null;
    this.map = new Map();
    this.register('identity', IdentityHandler);
    this.register('deflate', DeflateHandler);
    this.register('gzip', GzipHandler);
    this.setDefault('identity');
  }

  register (compressionName, compressionMethodConstructor) {
    if (typeof compressionName !== 'string') {
      throw new TypeError('Compression method must be a string');
    }

    if (typeof compressionMethodConstructor !== 'function') {
      throw new TypeError('Compression method constructor must be a function');
    }

    this.map.set(compressionName, compressionMethodConstructor);
    this.accepts = Array.from(this.map.keys());
  }

  setDefault (compressionName) {
    if (typeof compressionName !== 'string') {
      throw new TypeError('Compression method must be a string');
    }

    if (!this.map.has(compressionName)) {
      // TODO: This error code must be UNIMPLEMENTED.
      throw new Error(`Compression method not supported: ${compressionName}`);
    }

    this.default = compressionName;
  }

  getDefaultInstance () {
    return this.getInstance(this.default);
  }

  getInstance (compressionName) {
    if (typeof compressionName !== 'string') {
      throw new TypeError('Compression method must be a string');
    }

    const Ctor = this.map.get(compressionName);

    if (Ctor === undefined) {
      // TODO: This error code must be UNIMPLEMENTED.
      throw new Error(`Compression method not supported: ${compressionName}`);
    }

    return new Ctor();
  }
}


const compressionMethods = new CompressionMethodMap();
const defaultCompression = compressionMethods.getDefaultInstance();
const defaultAcceptedEncoding = compressionMethods.accepts;


class CompressionFilter {
  constructor () {
    this.supportedMethods = compressionMethods;
    this.send = defaultCompression;
    this.receive = defaultCompression;
    this.accepts = defaultAcceptedEncoding;
  }

  sendHeaders () {
    return {
      [kGrpcEncodingHeader]: this.send.name,
      [kGrpcAcceptEncodingHeader]: this.accepts.join(',')
    };
  }

  receiveMetadata (metadata) {
    const receiveEncoding = metadata.get(kGrpcEncodingHeader);

    if (receiveEncoding.length > 0) {
      const encoding = receiveEncoding[0];

      if (encoding !== this.receive.name) {
        this.receive = this.supportedMethods.getInstance(encoding);
      }
    }

    const acceptedEncoding = metadata.get(kGrpcAcceptEncodingHeader);

    if (acceptedEncoding.length > 0) {
      this.accepts = acceptedEncoding;
    }

    // Check that the client supports the incoming compression type.
    if (this.accepts.includes(this.receive.name)) {
      if (this.send.name !== this.receive.name) {
        this.send = this.supportedMethods.getInstance(this.receive.name);
      }
    } else {
      // The client does not support this compression type, so send
      // back uncompressed data.
      if (this.send.name !== 'identity') {
        this.send = this.supportedMethods.getInstance(this.receive.name);
      }
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

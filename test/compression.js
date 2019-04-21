'use strict';
const Assert = require('assert');
const Lab = require('lab');
const Compression = require('../lib/compression-filter');

// Test shortcuts
const lab = exports.lab = Lab.script();
const { describe, it } = lab;


describe('Compression', () => {
  describe('IdentityHandler', () => {
    it('constructs an IdentityHandler instance', () => {
      const handler = new Compression.IdentityHandler();

      Assert(handler instanceof Compression.IdentityHandler);
      Assert.strictEqual(handler.name, 'identity');
    });

    it('throws when trying to compress', () => {
      const handler = new Compression.IdentityHandler();

      Assert.throws(() => {
        handler.compressMessage();
      }, /Error: Identity encoding does not support compression/);
    });

    it('throws when trying to decompress', () => {
      const handler = new Compression.IdentityHandler();

      Assert.throws(() => {
        handler.decompressMessage();
      }, /Error: Identity encoding does not support compression/);
    });

    it('frames and unframes a message', async () => {
      const handler = new Compression.IdentityHandler();
      const data = Buffer.from('abc');
      const processed = handler.writeMessage(data);

      Assert(Buffer.isBuffer(processed));
      Assert.strictEqual(processed.byteLength, 8);
      Assert.deepStrictEqual(await handler.readMessage(processed), data);
    });

    it('throws during reading if the message is compressed', async () => {
      const handler = new Compression.IdentityHandler();
      const data = Buffer.from('abc');
      const processed = handler.writeMessage(data);

      processed.writeUInt8(1, 0);
      await Assert.rejects(async () => {
        await handler.readMessage(processed);
      }, /Error: Identity encoding does not support compression/);
    });
  });

  describe('GzipHandler', () => {
    it('constructs a GzipHandler instance', () => {
      const handler = new Compression.GzipHandler();

      Assert(handler instanceof Compression.GzipHandler);
      Assert.strictEqual(handler.name, 'gzip');
    });

    it('frames and unframes a message', async () => {
      const handler = new Compression.GzipHandler();
      const data = Buffer.from('abc');
      const processed = await handler.writeMessage(data, true);

      Assert(Buffer.isBuffer(processed));
      Assert(processed.byteLength > 8);
      Assert.deepStrictEqual(await handler.readMessage(processed), data);
    });

    it('frames and unframes a message without compressing', async () => {
      const handler = new Compression.GzipHandler();
      const data = Buffer.from('abc');
      const processed = await handler.writeMessage(data, false);

      Assert(Buffer.isBuffer(processed));
      Assert.strictEqual(processed.byteLength, 8);
      Assert.deepStrictEqual(await handler.readMessage(processed), data);
    });
  });

  describe('DeflateHandler', () => {
    it('constructs a DeflateHandler instance', () => {
      const handler = new Compression.DeflateHandler();

      Assert(handler instanceof Compression.DeflateHandler);
      Assert.strictEqual(handler.name, 'deflate');
    });

    it('frames and unframes a message', async () => {
      const handler = new Compression.DeflateHandler();
      const data = Buffer.from('abc');
      const processed = await handler.writeMessage(data, true);

      Assert(Buffer.isBuffer(processed));
      Assert(processed.byteLength > 8);
      Assert.deepStrictEqual(await handler.readMessage(processed), data);
    });

    it('frames and unframes a message without compressing', async () => {
      const handler = new Compression.DeflateHandler();
      const data = Buffer.from('abc');
      const processed = await handler.writeMessage(data, false);

      Assert(Buffer.isBuffer(processed));
      Assert.strictEqual(processed.byteLength, 8);
      Assert.deepStrictEqual(await handler.readMessage(processed), data);
    });
  });
});

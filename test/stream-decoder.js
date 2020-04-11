'use strict';
const Assert = require('assert');
const Lab = require('@hapi/lab');
const { StreamDecoder } = require('../lib/stream-decoder');
const { describe, it } = exports.lab = Lab.script();


describe('StreamDecoder', () => {
  describe('write()', () => {
    it('throws if the decoder is in an unknown state', () => {
      const decoder = new StreamDecoder();
      const data = Buffer.alloc(1);

      decoder.readState = 'invalid';
      Assert.throws(() => {
        decoder.write(data);
      }, /^Error: Unexpected read state$/);
    });
  });
});

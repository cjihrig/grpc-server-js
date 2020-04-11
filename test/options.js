'use strict';
const Assert = require('assert');
const Http2 = require('http2');
const Lab = require('@hapi/lab');
const { parseOptions } = require('../lib/options');
const { describe, it } = exports.lab = Lab.script();


describe('Options', () => {
  describe('parseOptions()', () => {
    it('parses default options', () => {
      Assert.deepStrictEqual(parseOptions(), {
        maxConcurrentStreams: undefined,
        maxFrameSize: Http2.getDefaultSettings().maxFrameSize,
        keepaliveTimeMs: 7200000,
        keepaliveTimeoutMs: 20000,
        maxSendMessageLength: Infinity,
        maxReceiveMessageLength: 4 * 1024 * 1024
      });
    });

    it('throws on unexpected options', () => {
      Assert.throws(() => {
        parseOptions({ foo: 'bar' });
      }, /^Error: unknown option: foo$/);
    });

    it('grpc.max_{send,receive}_message_length maps -1 to Infinity', () => {
      const options = parseOptions({
        'grpc.max_send_message_length': -1,
        'grpc.max_receive_message_length': -1
      });

      Assert.strictEqual(options.maxSendMessageLength, Infinity);
      Assert.strictEqual(options.maxReceiveMessageLength, Infinity);
    });
  });
});

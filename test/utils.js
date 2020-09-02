'use strict';
const Assert = require('assert');
const Lab = require('@hapi/lab');
const { hasGrpcStatusCode } = require('../lib/utils');
const Status = require('../lib/status');
const { describe, it } = exports.lab = Lab.script();


describe('Utils', () => {
  describe('hasGrpcStatusCode()', () => {
    it('detects valid status codes on objects', () => {
      Assert.strictEqual(hasGrpcStatusCode({}), false);
      Assert.strictEqual(hasGrpcStatusCode({ code: null }), false);
      Assert.strictEqual(hasGrpcStatusCode({ code: -1 }), false);
      Assert.strictEqual(hasGrpcStatusCode({ code: 17 }), false);

      Object.keys(Status).forEach((name) => {
        const status = Status[name];

        Assert.strictEqual(hasGrpcStatusCode({ code: status }), true);

        // Make sure no new status codes sneak in.
        Assert(status >= 0 && status <= 16);
      });
    });
  });
});

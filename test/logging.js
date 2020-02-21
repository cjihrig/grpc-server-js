'use strict';
const Assert = require('assert');
const Lab = require('@hapi/lab');
const Grpc = require('../lib');
const Logging = require('../lib/logging');

// Test shortcuts
const lab = exports.lab = Lab.script();
const { describe, it, afterEach } = lab;


describe('Logging', () => {
  afterEach(() => {
    // Ensure that the logger is restored to its defaults after each test.
    Grpc.setLogger(console);
    Grpc.setLogVerbosity(Grpc.logVerbosity.ERROR);
  });

  it('logger defaults to console', () => {
    Assert.strictEqual(Logging.getLogger(), console);
  });

  it('sets the logger to a new value', () => {
    const logger = {};

    Grpc.setLogger(logger);
    Assert.strictEqual(Logging.getLogger(), logger);
  });

  it('gates logging based on severity', () => {
    const output = [];
    const logger = {
      error (...args) {
        output.push(args);
      }
    };

    Grpc.setLogger(logger);

    // The default verbosity (ERROR) should not log DEBUG or INFO data.
    Logging.log(Grpc.logVerbosity.DEBUG, 4, 5, 6);
    Logging.log(Grpc.logVerbosity.INFO, 7, 8);
    Logging.log(Grpc.logVerbosity.ERROR, 'j', 'k');

    // The DEBUG verbosity should log everything.
    Grpc.setLogVerbosity(Grpc.logVerbosity.DEBUG);
    Logging.log(Grpc.logVerbosity.DEBUG, 'a', 'b', 'c');
    Logging.log(Grpc.logVerbosity.INFO, 'd', 'e');
    Logging.log(Grpc.logVerbosity.ERROR, 'f');

    // The INFO verbosity should not log DEBUG data.
    Grpc.setLogVerbosity(Grpc.logVerbosity.INFO);
    Logging.log(Grpc.logVerbosity.DEBUG, 1, 2, 3);
    Logging.log(Grpc.logVerbosity.INFO, 'g');
    Logging.log(Grpc.logVerbosity.ERROR, 'h', 'i');

    Assert.deepStrictEqual(output, [
      ['j', 'k'],
      ['a', 'b', 'c'],
      ['d', 'e'],
      ['f'],
      ['g'],
      ['h', 'i']
    ]);
  });

  it('handles loggers with no error() function', () => {
    const logger = {};

    Grpc.setLogger(logger);
    Logging.log(Grpc.logVerbosity.ERROR, 'foo');
  });
});

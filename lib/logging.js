'use strict';
const LogVerbosity = {
  DEBUG: 0,
  INFO: 1,
  ERROR: 2
};
const envVerbosity = LogVerbosity[process.env.GRPC_VERBOSITY];
let _logger = console;
let _logVerbosity = envVerbosity !== undefined ? envVerbosity :
  LogVerbosity.ERROR;


function getLogger () {
  return _logger;
}


function setLogger (logger) {
  _logger = logger;
}


function setLogVerbosity (verbosity) {
  _logVerbosity = verbosity;
}


function log (severity, ...args) {
  if (severity >= _logVerbosity && typeof _logger.error === 'function') {
    _logger.error(...args);
  }
}


module.exports = {
  getLogger,
  log,
  LogVerbosity,
  setLogger,
  setLogVerbosity
};

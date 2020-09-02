'use strict';
const Status = require('./status');


function hasGrpcStatusCode (obj) {
  return 'code' in obj &&
    Number.isInteger(obj.code) &&
    obj.code >= Status.OK &&
    obj.code <= Status.UNAUTHENTICATED;
}


module.exports = { hasGrpcStatusCode };

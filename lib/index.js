'use strict';
const { ServerCredentials } = require('@grpc/grpc-js');
const { Server } = require('./server');

module.exports = { Server, ServerCredentials };

'use strict';
const EventEmitter = require('events');


class ServerUnaryCall extends EventEmitter {
  constructor (call, metadata) {
    super();
    this.call = call;
    this.metadata = metadata;
    this.cancelled = false;
    this.request = undefined;
  }

  // eslint-disable-next-line class-methods-use-this
  sendMetadata (responseMetadata) {
    // TODO: Implement this. See grpc-native-core/src/server.js
    throw new Error('not implemented');
  }

  // eslint-disable-next-line class-methods-use-this
  getPeer () {
    // TODO: Implement this. See grpc-native-core/src/server.js
    throw new Error('not implemented');
  }

  // eslint-disable-next-line class-methods-use-this
  waitForCancel () {
    // TODO: Implement this. See grpc-native-core/src/server.js
    throw new Error('not implemented');
  }
}

module.exports = { ServerUnaryCall };

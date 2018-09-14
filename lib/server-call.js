'use strict';
const EventEmitter = require('events');
const Http2 = require('http2');
const { Metadata, status: Status } = require('@grpc/grpc-js');
const { CompressionFilter } =
  require('@grpc/grpc-js/build/src/compression-filter');
const kGrpcTimeoutHeader = 'grpc-timeout';
const kDeadlineRegex = /(\d{1,8})\s*([HMSmun])/;
const deadlineUnitsToMs = {
  H: 3600000,
  M: 60000,
  S: 1000,
  m: 1,
  u: 0.001,
  n: 0.000001
};
const defaultResponseHeaders = {
  ':status': 200,
  'content-type': 'application/grpc+proto'
};
const defaultResponseOptions = { waitForTrailers: true };
const defaultTrailers = {
  'grpc-status': 0,
  'grpc-message': 'OK',
  'content-type': 'application/grpc+proto'
};


class ServerCall extends EventEmitter {
  constructor (stream) {
    super();
    this.handler = null;
    this.stream = stream;
    this.cancelled = false;
    this.deadline = null;
    this.compression = new CompressionFilter();
    this.stream.once('error', onStreamError.bind(this));
    this.stream.once('close', onStreamClose.bind(this));
  }

  receiveMetadata (headers) {
    const filteredHeaders = {};
    let timeout = Infinity;

    Object.keys(headers).forEach((key) => {
      // Skip all reserved headers. They have no special meaning to gRPC, and
      // they cause Metadata.fromHttp2Headers() to throw.
      if (key.charAt(0) === ':') {
        return;
      }

      const value = headers[key];

      if (key === kGrpcTimeoutHeader) {
        const match = value.match(kDeadlineRegex);

        if (match === null) {
          // TODO: Bad request error?
          return;
        }

        timeout = (+match[1] * deadlineUnitsToMs[match[2]]) | 0;
        return;
      }

      filteredHeaders[key] = value;
    });

    const metadata = Metadata.fromHttp2Headers(filteredHeaders);

    if (timeout !== Infinity) {
      this.deadline = setTimeout(handleExpiredDeadline, timeout, this);
    }

    return metadata;
  }

  async receiveUnaryMessage () {  // eslint-disable-line require-await
    return new Promise((resolve, reject) => {
      const stream = this.stream;
      const chunks = [];
      let totalLength = 0;

      stream.on('data', (data) => {
        chunks.push(data);
        totalLength += data.byteLength;
      });

      stream.once('end', async () => {
        try {
          const requestBytes = Buffer.concat(chunks, totalLength);

          resolve(await this.deserializeMessage(requestBytes));
        } catch (err) {
          this.sendError(err, Status.INTERNAL);
          resolve();
        }
      });
    });
  }

  serializeMessage (value) {
    const messageBuffer = this.handler.serialize(value);
    const response = Buffer.allocUnsafe(messageBuffer.byteLength + 5);

    // TODO: Use the CompressionFilter here?
    response.writeUInt8(0, 0);
    response.writeUInt32BE(messageBuffer.byteLength, 1);
    messageBuffer.copy(response, 5);

    return response;
  }

  async deserializeMessage (bytes) {
    const receivedMessage = await this.compression.receiveMessage(bytes);

    return this.handler.deserialize(receivedMessage);
  }

  sendUnaryMessage (err, value, metadata, flags) {
    if (err) {
      if (metadata) {
        err.metadata = metadata;
      }

      this.sendError(err);
      return;
    }

    try {
      const response = this.serializeMessage(value);

      send(this, response, metadata, null);
    } catch (err) {
      this.sendError(err, Status.INTERNAL);
    }
  }

  sendError (error, code = Status.UNKNOWN) {
    let metadata;
    let details;

    if (error.hasOwnProperty('message')) {
      details = error.message;
    } else {
      details = 'Unknown Error';
    }

    if (error.hasOwnProperty('code') && Number.isInteger(error.code)) {
      code = error.code;

      if (error.hasOwnProperty('details')) {
        details = error.details;
      }
    }

    if (error.hasOwnProperty('metadata')) {
      metadata = error.metadata;
    }

    send(this, undefined, metadata, {
      'grpc-status': code,
      'grpc-message': details
    });
  }
}

module.exports = { ServerCall };


function onStreamError (err) {
  // `this` is bound to the Call instance, not the stream itself.
  this.sendError(err, Status.INTERNAL);
}


function onStreamClose () {
  // `this` is bound to the Call instance, not the stream itself.
  if (this.stream.rstCode === Http2.constants.NGHTTP2_CANCEL) {
    this.cancelled = true;
    this.emit('cancelled', 'cancelled');
  }
}


function handleExpiredDeadline (call) {
  call.cancelled = true;
  call.sendError(new Error('Deadline exceeded'), Status.DEADLINE_EXCEEDED);
  call.emit('cancelled', 'deadline');
}


// TODO: Make sure everything is cleaned up afterwards.
// function cleanup (call) {
//   call.deadline = null;
//   remove onStreamError
//   remote stream wantTrailers handler
// }


function send (call, payload, metadata, trailers) {
  const { stream } = call;

  if (stream.headersSent === true || call.cancelled === true) {
    return;
  }

  if (call.deadline !== null) {
    clearTimeout(call.deadline);
    call.deadline = null;
  }

  stream.once('wantTrailers', () => {
    const metadataTrailers = metadata ? metadata.toHttp2Headers() : null;
    const trailersToSend = Object.assign({}, defaultTrailers, trailers,
      metadataTrailers);

    stream.sendTrailers(trailersToSend);
  });

  stream.respond(defaultResponseHeaders, defaultResponseOptions);
  stream.end(payload);
}

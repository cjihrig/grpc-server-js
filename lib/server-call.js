'use strict';
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


class ServerCall {
  constructor (stream) {
    this.handler = null;
    this.stream = stream;
    this.stream.once('error', onStreamError.bind(this));
    this._filter = new CompressionFilter();
    this._deadline = null;
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
      this._deadline = setTimeout(handleExpiredDeadline, timeout, this);
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
          const receivedMessage = await this._filter.receiveMessage(requestBytes);

          resolve(this.handler.deserialize(receivedMessage));
        } catch (err) {
          this.sendError(err, Status.INTERNAL);
          resolve();
        }
      });
    });
  }

  sendUnaryMessage (value, serialize, metadata, flags) {
    try {
      const messageBuffer = serialize(value);
      const response = Buffer.allocUnsafe(messageBuffer.byteLength + 5);

      // TODO: Use the CompressionFilter here?
      response.writeUInt8(0, 0);
      response.writeUInt32BE(messageBuffer.byteLength, 1);
      messageBuffer.copy(response, 5);
      send(this.stream, response, metadata, null);
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

    send(this.stream, undefined, metadata, {
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


function handleExpiredDeadline (call) {
  call.sendError(new Error('Deadline exceeded'), Status.DEADLINE_EXCEEDED);
}


// TODO: Make sure everything is cleaned up afterwards.
// function cleanup (call) {
//   call._deadline = null;
//   remove onStreamError
//   remote stream wantTrailers handler
// }


function send (stream, payload, metadata, trailers) {
  if (stream.headersSent === true) {
    return;
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

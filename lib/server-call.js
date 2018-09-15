'use strict';
const EventEmitter = require('events');
const Http2 = require('http2');
const { Metadata, status: Status } = require('@grpc/grpc-js');
const { CompressionFilter } = require('./compression-filter');
const kGrpcMessageHeader = 'grpc-message';
const kGrpcStatusHeader = 'grpc-status';
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
  [Http2.constants.HTTP2_HEADER_STATUS]: Http2.constants.HTTP_STATUS_OK,
  [Http2.constants.HTTP2_HEADER_CONTENT_TYPE]: 'application/grpc+proto'
};
const defaultResponseOptions = { waitForTrailers: true };


class ServerCall extends EventEmitter {
  constructor (stream) {
    super();
    this.handler = null;
    this.stream = stream;
    this.cancelled = false;
    this.deadline = null;
    this.compression = new CompressionFilter();
    this.status = { code: Status.OK, details: 'OK', metadata: null };
    this.stream.once('error', onStreamError.bind(this));
    this.stream.once('close', onStreamClose.bind(this));
  }

  sendMetadata (customMetadata) {
    if (this.stream.headersSent === true) {
      return;
    }

    let headers;

    if (customMetadata) {
      headers = Object.assign({}, defaultResponseHeaders,
        customMetadata.toHttp2Headers());
    } else {
      headers = defaultResponseHeaders;
    }

    this.stream.once('wantTrailers', onWantTrailers.bind(this));
    this.stream.respond(headers, defaultResponseOptions);
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

    let metadata = Metadata.fromHttp2Headers(filteredHeaders);

    metadata = this.compression.receiveMetadata(metadata);

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

  async serializeMessage (value) {  // eslint-disable-line require-await
    const messageBuffer = this.handler.serialize(value);

    return this.compression.serializeMessage(messageBuffer);
  }

  async deserializeMessage (bytes) {
    const receivedMessage = await this.compression.deserializeMessage(bytes);

    return this.handler.deserialize(receivedMessage);
  }

  async sendUnaryMessage (err, value, metadata, flags) {
    if (err) {
      if (metadata) {
        err.metadata = metadata;
      }

      this.sendError(err);
      return;
    }

    try {
      const response = await this.serializeMessage(value);

      if (metadata) {
        this.status.metadata = metadata;
      }

      this.end(response);
    } catch (err) {
      this.sendError(err, Status.INTERNAL);
    }
  }

  sendError (error, code = Status.UNKNOWN) {
    const { status } = this;

    if (error.hasOwnProperty('message')) {
      status.details = error.message;
    } else {
      status.details = 'Unknown Error';
    }

    if (error.hasOwnProperty('code') && Number.isInteger(error.code)) {
      status.code = error.code;

      if (error.hasOwnProperty('details')) {
        status.details = error.details;
      }
    } else {
      status.code = code;
    }

    if (error.hasOwnProperty('metadata')) {
      status.metadata = error.metadata;
    }

    this.end(undefined);
  }

  write (chunk) {
    if (this.cancelled === true) {
      return;
    }

    this.sendMetadata();
    return this.stream.write(chunk);
  }

  end (payload) {
    if (this.cancelled === true) {
      return;
    }

    if (this.deadline !== null) {
      clearTimeout(this.deadline);
      this.deadline = null;
    }

    this.sendMetadata();
    return this.stream.end(payload);
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


function onWantTrailers () {
  // `this` is bound to the Call instance, not the stream itself.
  let trailersToSend = {
    [kGrpcStatusHeader]: this.status.code,
    [kGrpcMessageHeader]: this.status.details
  };
  const metadata = this.status.metadata;

  if (this.status.metadata) {
    trailersToSend = Object.assign(trailersToSend, metadata.toHttp2Headers());
  }

  this.stream.sendTrailers(trailersToSend);
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

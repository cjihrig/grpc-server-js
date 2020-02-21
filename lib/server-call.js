'use strict';
const EventEmitter = require('events');
const Http2 = require('http2');
const { CompressionFilter } = require('./compression-filter');
const { Metadata } = require('./metadata');
const Status = require('./status');
const kGrpcMessageHeader = 'grpc-message';
const kGrpcStatusHeader = 'grpc-status';
const kGrpcTimeoutHeader = 'grpc-timeout';
const kGrpcEncodingHeader = 'grpc-encoding';
const kGrpcAcceptEncodingHeader = 'grpc-accept-encoding';
const kDeadlineRegex = /(\d{1,8})\s*([HMSmun])/;
const deadlineUnitsToMs = {
  H: 3600000,
  M: 60000,
  S: 1000,
  m: 1,
  u: 0.001,
  n: 0.000001
};
const defaultResponseOptions = { waitForTrailers: true };
const {
  HTTP2_HEADER_CONTENT_TYPE,
  HTTP2_HEADER_STATUS,
  HTTP_STATUS_OK,
  NGHTTP2_CANCEL
} = Http2.constants;


class ServerCall extends EventEmitter {
  constructor (stream) {
    super();
    this.handler = null;
    this.stream = stream;
    this.cancelled = false;
    this.deadline = null;
    this.compression = new CompressionFilter();
    this.metadataSent = false;
    this.status = { code: Status.OK, details: 'OK', metadata: null };
    this.stream.on('drain', onStreamDrain.bind(this));
    this.stream.once('error', onStreamError.bind(this));
    this.stream.once('close', onStreamClose.bind(this));
  }

  sendMetadata (customMetadata) {
    if (this.metadataSent === true || this.cancelled === true ||
        this.stream.destroyed === true) {
      return;
    }

    this.metadataSent = true;

    const headers = {
      [kGrpcEncodingHeader]: this.compression.send.name,
      [kGrpcAcceptEncodingHeader]: this.compression.accepts.join(','),
      [HTTP2_HEADER_STATUS]: HTTP_STATUS_OK,
      [HTTP2_HEADER_CONTENT_TYPE]: 'application/grpc+proto'
    };

    this.stream.once('wantTrailers', onWantTrailers.bind(this));

    if (customMetadata === undefined || customMetadata === null) {
      this.stream.respond(headers, defaultResponseOptions);
    } else {
      this.stream.respond({
        ...headers,
        ...customMetadata.toHttp2Headers()
      }, defaultResponseOptions);
    }
  }

  receiveMetadata (headers) {
    let metadata = Metadata.fromHttp2Headers(headers);

    metadata = this.compression.receiveMetadata(metadata);

    const timeoutHeader = metadata.get(kGrpcTimeoutHeader);

    if (timeoutHeader.length > 0) {
      const match = timeoutHeader[0].match(kDeadlineRegex);

      if (match === null) {
        this.sendError(new Error('Invalid deadline'), Status.OUT_OF_RANGE);
        return;
      }

      const timeout = (+match[1] * deadlineUnitsToMs[match[2]]) | 0;

      this.deadline = setTimeout(handleExpiredDeadline, timeout, this);
      metadata.remove(kGrpcTimeoutHeader);
    }

    return metadata;
  }

  receiveUnaryMessage (callback) {
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

        callback(null, await this.deserializeMessage(requestBytes));
      } catch (err) {
        this.sendError(err, Status.INTERNAL);
        callback(err, null);
      }
    });
  }

  serializeMessage (value) {
    const messageBuffer = this.handler.serialize(value);

    return this.compression.serializeMessage(messageBuffer);
  }

  async deserializeMessage (bytes) {
    const receivedMessage = await this.compression.deserializeMessage(bytes);

    return this.handler.deserialize(receivedMessage);
  }

  async sendUnaryMessage (err, value, metadata, flags) {
    if (err) {
      if (metadata && !err.hasOwnProperty('metadata')) {
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

    if ('message' in error) {
      status.details = error.message;
    } else {
      status.details = 'Unknown Error';
    }

    if ('code' in error && Number.isInteger(error.code)) {
      status.code = error.code;

      if ('details' in error && typeof error.details === 'string') {
        status.details = error.details;
      }
    } else {
      status.code = code;
    }

    if ('metadata' in error && error.metadata !== undefined) {
      status.metadata = error.metadata;
    }

    this.end();
  }

  write (chunk) {
    if (this.cancelled === true || this.stream.destroyed === true) {
      return;
    }

    this.sendMetadata();
    return this.stream.write(chunk);
  }

  end (payload) {
    if (this.cancelled === true || this.stream.destroyed === true) {
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


function onStreamDrain () {
  // `this` is bound to the Call instance, not the stream itself.
  this.emit('drain');
}

function onStreamError (err) {
  // `this` is bound to the Call instance, not the stream itself.
  this.sendError(err, Status.INTERNAL);
}


function onStreamClose () {
  // `this` is bound to the Call instance, not the stream itself.
  if (this.stream.rstCode === NGHTTP2_CANCEL) {
    this.cancelled = true;
    this.emit('cancelled', 'cancelled');
  }
}


function onWantTrailers () {
  // `this` is bound to the Call instance, not the stream itself.
  let trailersToSend = {
    [kGrpcStatusHeader]: this.status.code,
    [kGrpcMessageHeader]: encodeURI(this.status.details)
  };
  const metadata = this.status.metadata;

  if (this.status.metadata !== null) {
    trailersToSend = { ...trailersToSend, ...metadata.toHttp2Headers() };
  }

  this.stream.sendTrailers(trailersToSend);
}


function handleExpiredDeadline (call) {
  call.sendError(new Error('Deadline exceeded'), Status.DEADLINE_EXCEEDED);
  call.cancelled = true;
  call.emit('cancelled', 'deadline');
}

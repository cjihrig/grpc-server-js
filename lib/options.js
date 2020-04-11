'use strict';
const Http2 = require('http2');
const defaultHttp2Settings = Http2.getDefaultSettings();
const defaultServerOptions = {
  'grpc.max_concurrent_streams': undefined,
  'grpc.http2.max_frame_size': defaultHttp2Settings.maxFrameSize,
  'grpc.keepalive_time_ms': 7200000,  // 2 hours in ms (spec default).
  'grpc.keepalive_timeout_ms': 20000, // 20 seconds in ms (spec default).
  'grpc.max_send_message_length': Infinity,
  'grpc.max_receive_message_length': 4 * 1024 * 1024  // 4 MB
};


function parseOptions (inputOptions) {
  const mergedOptions = { ...defaultServerOptions, ...inputOptions };

  // Check for unsupported options.
  for (const prop in mergedOptions) {
    if (!(prop in defaultServerOptions)) {
      throw new Error(`unknown option: ${prop}`);
    }
  }

  // Map the gRPC option names to normal camelCase property names.
  const options = {
    maxConcurrentStreams: mergedOptions['grpc.max_concurrent_streams'],
    maxFrameSize: mergedOptions['grpc.http2.max_frame_size'],
    keepaliveTimeMs: mergedOptions['grpc.keepalive_time_ms'],
    keepaliveTimeoutMs: mergedOptions['grpc.keepalive_timeout_ms'],
    maxSendMessageLength: mergedOptions['grpc.max_send_message_length'],
    maxReceiveMessageLength: mergedOptions['grpc.max_receive_message_length']
  };

  // grpc.max_send_message_length uses -1 to represent no max size.
  if (options.maxSendMessageLength === -1) {
    options.maxSendMessageLength = Infinity;
  }

  // grpc.max_receive_message_length uses -1 to represent no max size.
  if (options.maxReceiveMessageLength === -1) {
    options.maxReceiveMessageLength = Infinity;
  }

  return options;
}

module.exports = { parseOptions };

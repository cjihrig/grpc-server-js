'use strict';
const EventEmitter = require('events');

class ServerSession extends EventEmitter {
  constructor (http2Session, options) {
    super();
    this.http2Session = http2Session;
    this.options = options;
    this.keepaliveInterval = null;
    this.keepaliveTimeout = null;

    const teardown = onSessionClose.bind(this);
    this.http2Session.on('close', teardown);
    this.http2Session.on('error', teardown);
  }

  startKeepalivePings () {
    const sendPing = this.sendPing.bind(this);
    const intervalLength = this.options.keepaliveTimeMs;

    this.keepaliveInterval = setInterval(sendPing, intervalLength);
  }

  stopKeepalivePings () {
    clearInterval(this.keepaliveInterval);
    clearTimeout(this.keepaliveTimeout);
    this.keepaliveInterval = null;
    this.keepaliveTimeout = null;
  }

  sendPing () {
    this.keepaliveTimeout = setTimeout(() => {
      // The ping timed out.
      this.stopKeepalivePings();
      this.http2Session.destroy();
    }, this.options.keepaliveTimeoutMs);

    this.http2Session.ping((err, duration, payload) => {
      clearTimeout(this.keepaliveTimeout);

      if (err) {
        // The ping errored.
        this.stopKeepalivePings();
        this.http2Session.destroy();
      }
    });
  }
}

module.exports = { ServerSession };


function onSessionClose () {
  this.stopKeepalivePings();
  this.emit('close');
}

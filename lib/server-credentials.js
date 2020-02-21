'use strict';
const { readFileSync } = require('fs');
const cipherSuites = process.env.GRPC_SSL_CIPHER_SUITES;
const defaultRootsFilePath = process.env.GRPC_DEFAULT_SSL_ROOTS_FILE_PATH;
let defaultRootsData = null;


class InsecureServerCredentials {
  _isSecure () {    // eslint-disable-line class-methods-use-this
    return false;
  }

  _getSettings () { // eslint-disable-line class-methods-use-this
    return null;
  }
}


class SecureServerCredentials {
  constructor (options = {}) {
    this.options = options;
  }

  _isSecure () {    // eslint-disable-line class-methods-use-this
    return true;
  }

  _getSettings () {
    return this.options;
  }
}


class ServerCredentials {
  static createInsecure () {
    return new InsecureServerCredentials();
  }

  static createSsl (rootCerts, keyCertPairs, checkClientCertificate = false) {
    if (rootCerts !== null && !Buffer.isBuffer(rootCerts)) {
      throw new TypeError('rootCerts must be null or a Buffer');
    }

    if (!Array.isArray(keyCertPairs)) {
      throw new TypeError('keyCertPairs must be an array');
    }

    if (typeof checkClientCertificate !== 'boolean') {
      throw new TypeError('checkClientCertificate must be a boolean');
    }

    const cert = [];
    const key = [];

    for (let i = 0; i < keyCertPairs.length; i++) {
      const pair = keyCertPairs[i];

      if (pair === null || typeof pair !== 'object') {
        throw new TypeError(`keyCertPair[${i}] must be an object`);
      }

      if (!Buffer.isBuffer(pair.private_key)) {
        throw new TypeError(`keyCertPair[${i}].private_key must be a Buffer`);
      }

      if (!Buffer.isBuffer(pair.cert_chain)) {
        throw new TypeError(`keyCertPair[${i}].cert_chain must be a Buffer`);
      }

      cert.push(pair.cert_chain);
      key.push(pair.private_key);
    }

    return new SecureServerCredentials({
      ca: rootCerts || getDefaultRootsData() || undefined,
      cert,
      key,
      requestCert: checkClientCertificate,
      ciphers: cipherSuites
    });
  }
}

module.exports = { ServerCredentials };


function getDefaultRootsData () {
  if (!defaultRootsFilePath) {
    return null;
  }

  if (defaultRootsData === null) {
    defaultRootsData = readFileSync(defaultRootsFilePath);
  }

  return defaultRootsData;
}

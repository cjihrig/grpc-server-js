'use strict';

class ServerCredentials {
  constructor ({ secure, ca, cert, key, requestCert }) {
    this.secure = secure;

    if (secure === false) {
      this.settings = null;
    } else {
      this.settings = { ca, cert, key, requestCert };
    }
  }

  static createInsecure () {
    return new ServerCredentials({ secure: false });
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

      if (!Buffer.isBuffer(pair.privateKey)) {
        throw new TypeError(`keyCertPair[${i}].privateKey must be a Buffer`);
      }

      if (!Buffer.isBuffer(pair.certChain)) {
        throw new TypeError(`keyCertPair[${i}].certChain must be a Buffer`);
      }

      cert.push(pair.certChain);
      key.push(pair.privateKey);
    }

    return new ServerCredentials({
      secure: true,
      ca: rootCerts,
      cert,
      key,
      requestCert: checkClientCertificate
    });
  }
}

module.exports = { ServerCredentials };

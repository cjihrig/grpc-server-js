'use strict';
const { isAbsolute, resolve } = require('path');
const { URL } = require('url');


function resolveToListenOptions (target, secure) {
  if (target.startsWith('unix:')) {
    if (target.startsWith('unix://')) {
      const path = target.substring(7);

      // The path following 'unix://' must be absolute.
      if (!isAbsolute(path)) {
        throw new Error(`'${target}' must specify an absolute path`);
      }

      return { path };
    }

    // The path following 'unix:' can be relative or absolute.
    return { path: resolve(target.substring(5)) };
  }

  if (target.startsWith('dns:')) {
    target = target.substring(4);
  }

  const url = new URL(`http://${target}`);
  const defaultPort = secure === true ? 443 : 80;
  const port = String(+url.port) === url.port ? +url.port : defaultPort;

  return { host: url.hostname, port };
}


module.exports = { resolveToListenOptions };

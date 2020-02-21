'use strict';
const { log, LogVerbosity } = require('./logging');
const kLegalKeyRegex = /^[0-9a-z_.-]+$/;
const kLegalNonBinaryValueRegex = /^[ -~]*$/;


function isBinaryKey (key) {
  return key.endsWith('-bin');
}


function isCustomMetadata (key) {
  return !key.startsWith('grpc-');
}


function normalizeKey (key) {
  return key.toLowerCase();
}


function validate (key, value = null) {
  if (!kLegalKeyRegex.test(key)) {
    throw new Error(`Metadata key "${key}" contains illegal characters`);
  }

  if (value === null) {
    return;
  }

  if (isBinaryKey(key)) {
    if (!(value instanceof Buffer)) {
      throw new Error('keys that end with \'-bin\' must have Buffer values');
    }
  } else {
    if (value instanceof Buffer) {
      throw new Error(
        'keys that don\'t end with \'-bin\' must have String values'
      );
    }

    if (!kLegalNonBinaryValueRegex.test(value)) {
      throw new Error(
        `Metadata string value "${value}" contains illegal characters`
      );
    }
  }
}


class Metadata {
  constructor (options = {}) {
    this.options = options;
    this.internalRepr = new Map();
  }

  set (key, value) {
    key = normalizeKey(key);
    validate(key, value);
    this.internalRepr.set(key, [value]);
  }

  add (key, value) {
    key = normalizeKey(key);
    validate(key, value);

    const existingValue = this.internalRepr.get(key);

    if (existingValue === undefined) {
      this.internalRepr.set(key, [value]);
    } else {
      existingValue.push(value);
    }
  }

  remove (key) {
    key = normalizeKey(key);
    validate(key);
    this.internalRepr.delete(key);
  }

  get (key) {
    key = normalizeKey(key);
    validate(key);
    return this.internalRepr.get(key) || [];
  }

  getMap () {
    const result = {};

    this.internalRepr.forEach((values, key) => {
      if (values.length > 0) {
        const v = values[0];

        result[key] = v instanceof Buffer ? v.slice() : v;
      }
    });

    return result;
  }

  clone () {
    const newMetadata = new Metadata(this.options);
    const newInternalRepr = newMetadata.internalRepr;

    this.internalRepr.forEach((value, key) => {
      const clonedValue = value.map((v) => {
        return v instanceof Buffer ? Buffer.from(v) : v;
      });

      newInternalRepr.set(key, clonedValue);
    });

    return newMetadata;
  }

  merge (other) {
    other.internalRepr.forEach((values, key) => {
      const mergedValue = (this.internalRepr.get(key) || []).concat(values);

      this.internalRepr.set(key, mergedValue);
    });
  }

  setOptions (options) {
    this.options = options;
  }

  getOptions () {
    return this.options;
  }

  toHttp2Headers () {
    const result = {};

    this.internalRepr.forEach((values, key) => {
      result[key] = values.map((value) => {
        return value instanceof Buffer ? value.toString('base64') : value;
      });
    });

    return result;
  }

  static fromHttp2Headers (headers) {
    const result = new Metadata();

    Object.keys(headers).forEach((key) => {
      // Reserved headers (beginning with `:`) are not valid keys.
      if (key.charAt(0) === ':') {
        return;
      }

      const values = headers[key];

      try {
        if (isBinaryKey(key)) {
          if (Array.isArray(values)) {
            values.forEach((value) => {
              result.add(key, Buffer.from(value, 'base64'));
            });
          } else if (values !== undefined) {
            if (isCustomMetadata(key)) {
              values.split(',').forEach((v) => {
                result.add(key, Buffer.from(v.trim(), 'base64'));
              });
            } else {
              result.add(key, Buffer.from(values, 'base64'));
            }
          }
        } else {
          if (Array.isArray(values)) {
            values.forEach((value) => {
              result.add(key, value);
            });
          } else if (values !== undefined) {
            if (isCustomMetadata(key)) {
              values.split(',').forEach((v) => { result.add(key, v.trim()); });
            } else {
              result.add(key, values);
            }
          }
        }
      } catch (err) {
        log(
          LogVerbosity.ERROR,
          `Failed to add metadata entry ${key}: ${values}. ${err.message}.`
        );
      }
    });

    return result;
  }
}

module.exports = { Metadata };

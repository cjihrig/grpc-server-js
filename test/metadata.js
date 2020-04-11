'use strict';
const Assert = require('assert');
const Lab = require('@hapi/lab');
const { Metadata } = require('../lib');

// Test shortcuts
const lab = exports.lab = Lab.script();
const { describe, it, beforeEach } = lab;


describe('Metadata', () => {
  const validKeyChars = '0123456789abcdefghijklmnopqrstuvwxyz_-.';
  const validNonBinValueChars = range(0x20, 0x7f)
    .map((code) => { return String.fromCharCode(code); })
    .join('');
  let metadata;

  beforeEach(() => {
    metadata = new Metadata();
  });

  describe('set', () => {
    it('Only accepts string values for non-binary keys', () => {
      Assert.throws(() => {
        metadata.set('key', Buffer.from('value'));
      });

      Assert.doesNotThrow(() => {
        metadata.set('key', 'value');
      });
    });

    it('Only accepts Buffer values for binary keys', () => {
      Assert.throws(() => {
        metadata.set('key-bin', 'value');
      });

      Assert.doesNotThrow(() => {
        metadata.set('key-bin', Buffer.from('value'));
      });
    });

    it('Rejects invalid keys', () => {
      Assert.doesNotThrow(() => {
        metadata.set(validKeyChars, 'value');
      });

      Assert.throws(() => {
        metadata.set('key$', 'value');
      }, /Error: Metadata key "key\$" contains illegal characters/);

      Assert.throws(() => {
        metadata.set('', 'value');
      });
    });

    it('Rejects values with non-ASCII characters', () => {
      Assert.doesNotThrow(() => {
        metadata.set('key', validNonBinValueChars);
      });
      Assert.throws(() => {
        metadata.set('key', 'résumé');
      });
    });

    it('Saves values that can be retrieved', () => {
      metadata.set('key', 'value');
      Assert.deepStrictEqual(metadata.get('key'), ['value']);
    });

    it('Overwrites previous values', () => {
      metadata.set('key', 'value1');
      metadata.set('key', 'value2');
      Assert.deepStrictEqual(metadata.get('key'), ['value2']);
    });

    it('Normalizes keys', () => {
      metadata.set('Key', 'value1');
      Assert.deepStrictEqual(metadata.get('key'), ['value1']);
      metadata.set('KEY', 'value2');
      Assert.deepStrictEqual(metadata.get('key'), ['value2']);
    });
  });

  describe('add', () => {
    it('Only accepts string values for non-binary keys', () => {
      Assert.throws(() => {
        metadata.add('key', Buffer.from('value'));
      });

      Assert.doesNotThrow(() => {
        metadata.add('key', 'value');
      });
    });

    it('Only accepts Buffer values for binary keys', () => {
      Assert.throws(() => {
        metadata.add('key-bin', 'value');
      });

      Assert.doesNotThrow(() => {
        metadata.add('key-bin', Buffer.from('value'));
      });
    });

    it('Rejects invalid keys', () => {
      Assert.throws(() => {
        metadata.add('key$', 'value');
      });

      Assert.throws(() => {
        metadata.add('', 'value');
      });
    });

    it('Saves values that can be retrieved', () => {
      metadata.add('key', 'value');
      Assert.deepStrictEqual(metadata.get('key'), ['value']);
    });

    it('Combines with previous values', () => {
      metadata.add('key', 'value1');
      metadata.add('key', 'value2');
      Assert.deepStrictEqual(metadata.get('key'), ['value1', 'value2']);
    });

    it('Normalizes keys', () => {
      metadata.add('Key', 'value1');
      Assert.deepStrictEqual(metadata.get('key'), ['value1']);
      metadata.add('KEY', 'value2');
      Assert.deepStrictEqual(metadata.get('key'), ['value1', 'value2']);
    });
  });

  describe('remove', () => {
    it('clears values from a key', () => {
      metadata.add('key', 'value');
      metadata.remove('key');
      Assert.deepStrictEqual(metadata.get('key'), []);
    });

    it('Normalizes keys', () => {
      metadata.add('key', 'value');
      metadata.remove('KEY');
      Assert.deepStrictEqual(metadata.get('key'), []);
    });
  });

  describe('get', () => {
    beforeEach(() => {
      metadata.add('key', 'value1');
      metadata.add('key', 'value2');
      metadata.add('key-bin', Buffer.from('value'));
    });

    it('gets all values associated with a key', () => {
      Assert.deepStrictEqual(metadata.get('key'), ['value1', 'value2']);
    });

    it('Normalizes keys', () => {
      Assert.deepStrictEqual(metadata.get('KEY'), ['value1', 'value2']);
    });

    it('returns an empty list for non-existent keys', () => {
      Assert.deepStrictEqual(metadata.get('non-existent-key'), []);
    });

    it('returns Buffers for binary keys', () => {
      Assert.ok(metadata.get('key-bin')[0] instanceof Buffer);
    });
  });

  describe('getMap', () => {
    it('gets a map of keys to values', () => {
      metadata.add('key1', 'value1');
      metadata.add('Key2', 'value2');
      metadata.add('KEY3', 'value3a');
      metadata.add('KEY3', 'value3b');
      metadata.add('key4-bin', Buffer.from('value4'));
      Assert.deepStrictEqual(metadata.getMap(), {
        key1: 'value1',
        key2: 'value2',
        key3: 'value3a',
        'key4-bin': Buffer.from('value4')
      });
    });
  });

  describe('clone', () => {
    it('retains values from the original', () => {
      metadata.add('key', 'value');
      const copy = metadata.clone();
      Assert.deepStrictEqual(copy.get('key'), ['value']);
    });

    it('Does not see newly added values', () => {
      metadata.add('key', 'value1');
      const copy = metadata.clone();
      metadata.add('key', 'value2');
      Assert.deepStrictEqual(copy.get('key'), ['value1']);
    });

    it('Does not add new values to the original', () => {
      metadata.add('key', 'value1');
      const copy = metadata.clone();
      copy.add('key', 'value2');
      Assert.deepStrictEqual(metadata.get('key'), ['value1']);
    });

    it('Copy cannot modify binary values in the original', () => {
      const buf = Buffer.from('value-bin');
      metadata.add('key-bin', buf);
      const copy = metadata.clone();
      const copyBuf = copy.get('key-bin')[0];
      Assert.deepStrictEqual(copyBuf, buf);
      copyBuf.fill(0);
      Assert.notDeepStrictEqual(copyBuf, buf);
    });
  });

  describe('merge', () => {
    it('appends values from a given metadata object', () => {
      metadata.add('key1', 'value1');
      metadata.add('Key2', 'value2a');
      metadata.add('KEY3', 'value3a');
      metadata.add('key4', 'value4');
      const metadata2 = new Metadata();
      metadata2.add('KEY1', 'value1');
      metadata2.add('key2', 'value2b');
      metadata2.add('key3', 'value3b');
      metadata2.add('key5', 'value5a');
      metadata2.add('key5', 'value5b');
      const metadata2IR = metadata2.internalRepr;
      metadata.merge(metadata2);
      // Ensure metadata2 didn't change
      Assert.deepStrictEqual(
        metadata2.internalRepr,
        metadata2IR
      );
      Assert.deepStrictEqual(metadata.get('key1'), ['value1', 'value1']);
      Assert.deepStrictEqual(metadata.get('key2'), ['value2a', 'value2b']);
      Assert.deepStrictEqual(metadata.get('key3'), ['value3a', 'value3b']);
      Assert.deepStrictEqual(metadata.get('key4'), ['value4']);
      Assert.deepStrictEqual(metadata.get('key5'), ['value5a', 'value5b']);
    });
  });

  describe('toHttp2Headers', () => {
    it('creates an OutgoingHttpHeaders object with expected values', () => {
      metadata.add('key1', 'value1');
      metadata.add('Key2', 'value2');
      metadata.add('KEY3', 'value3a');
      metadata.add('key3', 'value3b');
      metadata.add('key-bin', Buffer.from(range(0, 16)));
      metadata.add('key-bin', Buffer.from(range(16, 32)));
      metadata.add('key-bin', Buffer.from(range(0, 32)));
      const headers = metadata.toHttp2Headers();
      Assert.deepStrictEqual(headers, {
        key1: ['value1'],
        key2: ['value2'],
        key3: ['value3a', 'value3b'],
        'key-bin': [
          'AAECAwQFBgcICQoLDA0ODw==',
          'EBESExQVFhcYGRobHB0eHw==',
          'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8='
        ]
      });
    });

    it('creates an empty header object from empty Metadata', () => {
      Assert.deepStrictEqual(metadata.toHttp2Headers(), {});
    });
  });

  describe('fromHttp2Headers', () => {
    it('creates a Metadata object with expected values', () => {
      const headers = {
        key1: 'value1',
        key2: ['value2'],
        key3: ['value3a', 'value3b'],
        'key-bin': [
          'AAECAwQFBgcICQoLDA0ODw==',
          'EBESExQVFhcYGRobHB0eHw==',
          'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8='
        ]
      };
      const metadataFromHeaders = Metadata.fromHttp2Headers(headers);
      const internalRepr = metadataFromHeaders.internalRepr;
      const expected = new Map([
        ['key1', ['value1']],
        ['key2', ['value2']],
        ['key3', ['value3a', 'value3b']],
        [
          'key-bin',
          [
            Buffer.from(range(0, 16)),
            Buffer.from(range(16, 32)),
            Buffer.from(range(0, 32))
          ]
        ]
      ]);
      Assert.deepStrictEqual(internalRepr, expected);
    });

    it('creates an empty Metadata object from empty headers', () => {
      const metadataFromHeaders = Metadata.fromHttp2Headers({});
      const internalRepr = metadataFromHeaders.internalRepr;
      Assert.deepStrictEqual(internalRepr, new Map());
    });
  });

  it('sets and gets metadata options', () => {
    const opts1 = { foo: 'bar' };
    const opts2 = { baz: 'quux' };

    const m = new Metadata(opts1);
    Assert.strictEqual(m.getOptions(), opts1);
    m.setOptions(opts2);
    Assert.strictEqual(m.getOptions(), opts2);
  });
});


function range (start, end) {
  const result = [];

  for (let i = start; i < end; i++) {
    result.push(i);
  }

  return result;
}

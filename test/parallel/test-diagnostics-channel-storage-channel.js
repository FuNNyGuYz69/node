'use strict';

const common = require('../common');
const dc = require('diagnostics_channel');
const { AsyncLocalStorage } = require('async_hooks');
const assert = require('assert');

const store = new AsyncLocalStorage();

const input = {
  foo: 'bar'
}

const output = {
  baz: 'buz'
};

dc.bindStore('test', store, common.mustCall((foundInput) => {
  assert.deepStrictEqual(foundInput, input);
  return output;
}));

const channel = dc.storageChannel('test');

assert.strictEqual(store.getStore(), undefined);

channel.run(input, common.mustCall(() => {
  assert.deepStrictEqual(store.getStore(), output);
}));

assert.strictEqual(store.getStore(), undefined);

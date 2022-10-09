'use strict';

const common = require('../common');
const dc = require('diagnostics_channel');
const assert = require('assert');

const channel = dc.tracingChannel('test');

const expectedError = new Error('test');
const input = { foo: 'bar' };

function check(found) {
  assert.deepStrictEqual(found, input);
}

const handlers = {
  start: common.mustCall(check),
  end: common.mustCall(check),
  asyncEnd: common.mustNotCall(),
  error: common.mustCall((found) => {
    check(found);
    assert.deepStrictEqual(found.error, expectedError);
  })
};

channel.subscribe(handlers);
try {
  channel.trace(() => {
    throw expectedError;
  }, input);
} catch (error) {
  assert.deepStrictEqual(error, expectedError);
}

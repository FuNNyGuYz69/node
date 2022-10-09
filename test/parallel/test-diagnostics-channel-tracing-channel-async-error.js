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
  start: common.mustCall(check, 2),
  end: common.mustCall(check, 2),
  asyncEnd: common.mustCall(check, 2),
  error: common.mustCall((found) => {
    check(found);
    assert.deepStrictEqual(found.error, expectedError);
  }, 2)
};

channel.subscribe(handlers);
channel.trace((done) => setImmediate(done, expectedError), input);
channel.trace(() => Promise.reject(expectedError), input);

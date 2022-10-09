'use strict';

const common = require('../common');
const dc = require('diagnostics_channel');
const assert = require('assert');

const channel = dc.tracingChannel('test');

const expectedResult = { foo: 'bar' };
const input = { foo: 'bar' };

function check(found) {
  assert.deepStrictEqual(found, input);
}

const handlers = {
  start: common.mustCall(check, 2),
  end: common.mustCall(check, 2),
  asyncEnd: common.mustCall((found) => {
    check(found);
    assert.deepStrictEqual(found.result, expectedResult);
  }, 2),
  error: common.mustNotCall()
};

channel.subscribe(handlers);
channel.trace((done) => setImmediate(done, null, expectedResult), input);
channel.trace(() => Promise.resolve(expectedResult), input);

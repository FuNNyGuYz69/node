'use strict';

const {
  ArrayPrototypeIndexOf,
  ArrayPrototypePush,
  ArrayPrototypeSplice,
  ObjectCreate,
  ObjectGetPrototypeOf,
  ObjectSetPrototypeOf,
  SymbolHasInstance,
} = primordials;

const {
  codes: {
    ERR_INVALID_ARG_TYPE,
  }
} = require('internal/errors');
const {
  validateFunction,
} = require('internal/validators');

const { triggerUncaughtException } = internalBinding('errors');

const { WeakReference } = internalBinding('util');

// TODO(qard): should there be a C++ channel interface?
class ActiveChannel {
  subscribe(subscription) {
    validateFunction(subscription, 'subscription');
    ArrayPrototypePush(this._subscribers, subscription);
  }

  unsubscribe(subscription) {
    const index = ArrayPrototypeIndexOf(this._subscribers, subscription);
    if (index === -1) return false;

    ArrayPrototypeSplice(this._subscribers, index, 1);

    // When there are no more active subscribers, restore to fast prototype.
    if (!this._subscribers.length) {
      // eslint-disable-next-line no-use-before-define
      ObjectSetPrototypeOf(this, Channel.prototype);
    }

    return true;
  }

  get hasSubscribers() {
    return true;
  }

  publish(data) {
    for (let i = 0; i < this._subscribers.length; i++) {
      try {
        const onMessage = this._subscribers[i];
        onMessage(data, this.name);
      } catch (err) {
        process.nextTick(() => {
          triggerUncaughtException(err, false);
        });
      }
    }
  }
}

class Channel {
  constructor(name) {
    this._subscribers = undefined;
    this.name = name;
  }

  static [SymbolHasInstance](instance) {
    const prototype = ObjectGetPrototypeOf(instance);
    return prototype === Channel.prototype ||
           prototype === ActiveChannel.prototype;
  }

  subscribe(subscription) {
    ObjectSetPrototypeOf(this, ActiveChannel.prototype);
    this._subscribers = [];
    this.subscribe(subscription);
  }

  unsubscribe() {
    return false;
  }

  get hasSubscribers() {
    return false;
  }

  publish() {}
}

const channels = ObjectCreate(null);

function channel(name) {
  let channel;
  const ref = channels[name];
  if (ref) channel = ref.get();
  if (channel) return channel;

  if (typeof name !== 'string' && typeof name !== 'symbol') {
    throw new ERR_INVALID_ARG_TYPE('channel', ['string', 'symbol'], name);
  }

  channel = new Channel(name);
  channels[name] = new WeakReference(channel);
  return channel;
}

function subscribe(name, subscription) {
  const chan = channel(name);
  channels[name].incRef();
  chan.subscribe(subscription);
}

function unsubscribe(name, subscription) {
  const chan = channel(name);
  if (!chan.unsubscribe(subscription)) {
    return false;
  }

  channels[name].decRef();
  return true;
}

function hasSubscribers(name) {
  let channel;
  const ref = channels[name];
  if (ref) channel = ref.get();
  if (!channel) {
    return false;
  }

  return channel.hasSubscribers;
}

class TracingChannel {
  constructor(name) {
    this.name = name;
    this.channels = {
      start: channel(`${name}.start`),
      end: channel(`${name}.end`),
      asyncEnd: channel(`${name}.asyncEnd`),
      error: channel(`${name}.error`)
    };
  }

  get hasSubscribers() {
    const { channels } = this;
    for (const key in channels) {
      if (channels[key].hasSubscribers) return true;
    }
    return false;
  }

  subscribe(handlers) {
    const { channels } = this;
    for (const key in handlers) {
      const channel = channels[key];
      if (!channel) continue;
      channel.subscribe(handlers[key]);
    }
  }

  unsubscribe(handlers) {
    const { channels } = this;
    for (const key in handlers) {
      const channel = channels[key];
      if (!channel) continue;
      channel.unsubscribe(handlers[key]);
    }
  }

  trace(fn, ctx = {}) {
    const { start, end, asyncEnd, error } = this.channels;
    start.publish(ctx);

    const fail = (err) => {
      ctx.error = err;
      error.publish(ctx);
    };

    const reject = (err) => {
      fail(err);
      asyncEnd.publish(ctx);
    };

    const resolve = (result) => {
      ctx.result = result;
      asyncEnd.publish(ctx);
    };

    try {
      if (fn.length) {
        return fn((err, res) => {
          if (err) return reject(err);
          resolve(res);
        });
      }

      const result = fn();
      if (result && typeof result.then === 'function') {
        result.then(resolve, reject);
      } else {
        ctx.result = result;
      }
      return result;
    } catch (err) {
      fail(err);
      throw err;
    } finally {
      end.publish(ctx);
    }
  }
}

function tracingChannel(name) {
  return new TracingChannel(name);
}

module.exports = {
  channel,
  hasSubscribers,
  subscribe,
  tracingChannel,
  unsubscribe,
  Channel
};

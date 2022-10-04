'use strict';

const {
  ArrayPrototypeIndexOf,
  ArrayPrototypePush,
  ArrayPrototypeSplice,
  ObjectCreate,
  ObjectGetPrototypeOf,
  ObjectSetPrototypeOf,
  SymbolHasInstance,
  Symbol
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

const { executionAsyncResource } = require('async_hooks');

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

function bindStore(name, store, build = (v) => v) {
  let lastStore;
  let sym;

  function onEnter({ sym: seenSym, data }) {
    sym = seenSym;
    store._enable();

    const resource = executionAsyncResource();
    lastStore = resource[store.kResourceStore];

    resource[store.kResourceStore] = build(data);
  }

  function onExit({ sym: seenSym }) {
    if (sym && sym === seenSym) {
      const resource = executionAsyncResource();
      resource[store.kResourceStore] = lastStore;
    }
  }

  subscribe(`${name}.enter-store`, onEnter);
  subscribe(`${name}.exit-store`, onExit);

  return () => {
    unsubscribe(`${name}.enter-store`, onEnter);
    unsubscribe(`${name}.exit-store`, onExit);
  };
}

class StorageChannelContext {
  constructor(channel, sym) {
    this.enterChannel = channel.enterChannel;
    this.exitChannel = channel.exitChannel;
    this.sym = sym;
  }

  enter(data) {
    this.enterChannel.publish({ sym: this.sym, data });
  }

  exit() {
    this.exitChannel.publish({ sym: this.sym });
  }

  run(data, fn) {
    this.enter(data);
    fn();
    this.exit();
  }
}

class StorageChannel {
  constructor(name) {
    this.enterChannel = channel(`${name}.enter-store`);
    this.exitChannel = channel(`${name}.exit-store`);
  }

  get hasSubscribers() {
    return this.enterChannel.hasSubscribers || this.exitChannel.hasSubscribers;
  }

  _context() {
    return new StorageChannelContext(this, Symbol('bind-store'));
  }

  run(...args) {
    return this._context().run(...args);
  }
}

function storageChannel(name) {
  return new StorageChannel(name);
}

module.exports = {
  // Basic channel interface
  channel,
  hasSubscribers,
  subscribe,
  unsubscribe,
  Channel,

  // AsyncLocalStorage integration
  bindStore,
  storageChannel,
  StorageChannel,
  StorageChannelContext
};

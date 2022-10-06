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

class StoreBinding {
  constructor(store, build = (v) => v) {
    this.store = store;
    this.build = build;
    this.stack = [];

    this.onEnter = this.onEnter.bind(this);
    this.onExit = this.onExit.bind(this);
  }

  onEnter(data) {
    this.stack.push(this.store.getStore());
    this.store.enterWith(this.build(data));
  }

  onExit() {
    if (!this.stack.length) return;
    this.store.enterWith(this.stack.pop());
  }
}

// TODO(qard): figure out if putting everything on the channel has the same GC
// issue as channel.subscribe(...) did.
class StorageChannel {
  constructor(name) {
    this._enter = channel(`${name}.enter-store`);
    this._exit = channel(`${name}.exit-store`);
    this.kBinding = Symbol('binding');
  }

  isBoundToStore (store) {
    return !!store[this.kBinding];
  }

  bindStore(store, build) {
    if (this.isBoundToStore(store)) return;
    const binding = new StoreBinding(store, build);
    store[this.kBinding] = binding;
    this._enter.subscribe(binding.onEnter);
    this._exit.subscribe(binding.onExit);
  }

  unbindStore(store) {
    if (!this.isBoundToStore(store)) return;
    const binding = store[this.kBinding];
    this._enter.unsubscribe(binding.onEnter);
    this._exit.unsubscribe(binding.onExit);
    delete store[this.kBinding];
  }

  run(data, fn) {
    this._enter.publish(data);
    try {
      return fn();
    } finally {
      this._exit.publish();
    }
  }
}

const storageChannels = ObjectCreate(null);

function storageChannel(name) {
  let channel;
  const ref = storageChannels[name];
  if (ref) channel = ref.get();
  if (channel) return channel;

  if (typeof name !== 'string' && typeof name !== 'symbol') {
    throw new ERR_INVALID_ARG_TYPE('channel', ['string', 'symbol'], name);
  }

  channel = new StorageChannel(name);
  storageChannels[name] = new WeakReference(channel);
  return channel;
}

module.exports = {
  channel,
  hasSubscribers,
  storageChannel,
  subscribe,
  unsubscribe,
  Channel
};

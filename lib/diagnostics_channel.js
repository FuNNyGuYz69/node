'use strict';

const {
  ArrayPrototypeIndexOf,
  ArrayPrototypePush,
  ArrayPrototypeSome,
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
class ActiveStorageChannel {
  get hasSubscribers () {
    return true;
  }

  isBoundToStore(store) {
    return ArrayPrototypeSome(this.bindings, v => v.store === store);
  }

  bindStore(store, build) {
    if (this.isBoundToStore(store)) return false;
    ArrayPrototypePush(this.bindings, new StoreBinding(store, build));
    return true;
  }

  unbindStore(store) {
    if (!this.isBoundToStore(store)) return false;

    let found = false;
    for (let index = 0; index < this.bindings.length; index++) {
      if (this.bindings[index].store === store) {
        ArrayPrototypeSplice(this.bindings, index, 1);
        found = true;
        break;
      }
    }

    if (!this.bindings.length) {
      ObjectSetPrototypeOf(this, StorageChannel.prototype);
      this.bindings = undefined;
    }

    return found;
  }

  _enter(data) {
    for (const binding of this.bindings) {
      binding.onEnter(data);
    }
  }

  _exit() {
    for (const binding of this.bindings) {
      binding.onExit();
    }
  }

  run(data, fn) {
    this._enter(data);
    try {
      return fn();
    } finally {
      this._exit();
    }
  }
}

class StorageChannel {
  constructor() {
    this.bindings = undefined;
  }

  static [SymbolHasInstance](instance) {
    const prototype = ObjectGetPrototypeOf(instance);
    return prototype === StorageChannel.prototype ||
      prototype === ActiveStorageChannel.prototype;
  }

  get hasSubscribers() {
    return false;
  }

  isBoundToStore(_) {
    return false;
  }

  bindStore(store, build) {
    ObjectSetPrototypeOf(this, ActiveStorageChannel.prototype);
    this.bindings = [];
    return this.bindStore(store, build);
  }

  unbindStore(_) {
    return false;
  }

  _enter(_) {}
  _exit() {}

  run(_, fn) {
    return fn();
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

/*
 * A small in-memory IndexedDB for the offline tests: the subset that
 * common/runlog.js uses (open with onupgradeneeded, createObjectStore with
 * a keyPath, one-store transactions, get / put / delete / clear / count /
 * getAll / getAllKeys, oncomplete / onerror / onabort, close). Requests
 * complete on a macrotask, as in a browser, so a promise continuation that
 * issues the next request keeps the transaction alive; the transaction
 * completes once no request is pending after that.
 *
 * `fake.quota = true` makes every put fail with a QuotaExceededError (the
 * transaction aborts with it), to check that the worker treats a full
 * database as a logged nuisance and not as a job failure. `fake.openError`
 * makes open() fail. `fake.reset()` empties every database; the data lives
 * in this module, so a fresh worker instance sees what the old one wrote.
 */
"use strict";

const databases = new Map(); // name -> { version, stores: Map(name -> { keyPath, data: Map }) }

class FakeDOMException extends Error {
  constructor(name, message) { super(message || name); this.name = name; }
}

// A macrotask (as a browser's request callbacks are), without setTimeout's
// 1 ms floor: the worker harness samples storage 10 ms after a message.
const later = (fn) => setImmediate(fn);

class FakeRequest {
  constructor() { this.result = undefined; this.error = null; this.onsuccess = null; this.onerror = null; this.onupgradeneeded = null; this.onblocked = null; this.readyState = "pending"; }
  _succeed(value) { this.result = value; this.readyState = "done"; if (this.onsuccess) this.onsuccess({ target: this }); }
  _fail(error) { this.error = error; this.readyState = "done"; if (this.onerror) this.onerror({ target: this }); }
}

class FakeTransaction {
  constructor(db, storeNames, mode) {
    this.db = db; this.mode = mode; this.error = null; this.oncomplete = null; this.onerror = null; this.onabort = null;
    this._names = Array.isArray(storeNames) ? storeNames : [storeNames];
    this._pending = 0; this._finished = false;
    // A transaction with no request completes on its own, as in a browser
    // (the caller issues its requests in the same task as the creation).
    later(() => this._maybeComplete());
  }
  _maybeComplete() {
    if (this._finished || this._pending > 0) return;
    this._finished = true;
    if (this.oncomplete) this.oncomplete({ target: this });
  }
  objectStore(name) {
    if (!this._names.includes(name)) throw new FakeDOMException("NotFoundError", `store ${name} not in this transaction`);
    const store = this.db._data.stores.get(name);
    if (!store) throw new FakeDOMException("NotFoundError", `no store ${name}`);
    return new FakeStore(this, name, store);
  }
  abort() {
    if (this._finished) throw new FakeDOMException("InvalidStateError", "transaction finished");
    this._finished = true;
    later(() => { if (this.onabort) this.onabort({ target: this }); });
  }
  _request(fn) {
    if (this._finished) throw new FakeDOMException("TransactionInactiveError", "transaction finished");
    const req = new FakeRequest();
    this._pending += 1;
    later(() => {
      this._pending -= 1;
      if (this._finished) return;
      let value, error = null;
      try { value = fn(); } catch (e) { error = e; }
      if (error) {
        this.error = error;
        req._fail(error);
        this._finished = true;
        if (this.onerror) this.onerror({ target: req });
        if (this.onabort) this.onabort({ target: this });
        return;
      }
      req._succeed(value);
      later(() => this._maybeComplete());
    });
    return req;
  }
}

class FakeStore {
  constructor(tx, name, store) { this.tx = tx; this.name = name; this.keyPath = store.keyPath; this._store = store; }
  _write(fn) {
    if (this.tx.mode !== "readwrite") throw new FakeDOMException("ReadOnlyError", "read-only transaction");
    return this.tx._request(fn);
  }
  get(key) { return this.tx._request(() => structuredClone(this._store.data.get(key))); }
  getAll() { return this.tx._request(() => Array.from(this._store.data.values()).map((v) => structuredClone(v))); }
  getAllKeys() { return this.tx._request(() => Array.from(this._store.data.keys())); }
  count() { return this.tx._request(() => this._store.data.size); }
  put(value) {
    return this._write(() => {
      if (fake.quota) throw new FakeDOMException("QuotaExceededError", "The quota has been exceeded.");
      const key = value[this.keyPath];
      if (key === undefined) throw new FakeDOMException("DataError", "no key");
      this._store.data.set(key, structuredClone(value));
      fake.puts += 1;
      return key;
    });
  }
  add(value) { return this.put(value); }
  delete(key) { return this._write(() => { this._store.data.delete(key); return undefined; }); }
  clear() { return this._write(() => { this._store.data.clear(); return undefined; }); }
}

class FakeDatabase {
  constructor(name, data) { this.name = name; this._data = data; this.version = data.version; this.closed = false; fake.openCount += 1; }
  get objectStoreNames() { const names = Array.from(this._data.stores.keys()); return { contains: (n) => names.includes(n), length: names.length }; }
  createObjectStore(name, opts) {
    if (!this._upgrading) throw new FakeDOMException("InvalidStateError", "not in a versionchange transaction");
    const store = { keyPath: (opts && opts.keyPath) || null, data: new Map() };
    this._data.stores.set(name, store);
    return { keyPath: store.keyPath, createIndex() {} };
  }
  transaction(storeNames, mode) {
    if (this.closed) throw new FakeDOMException("InvalidStateError", "database closed");
    return new FakeTransaction(this, storeNames, mode || "readonly");
  }
  close() { this.closed = true; fake.closeCount += 1; }
}

const fake = {
  quota: false,
  openError: null,
  puts: 0,
  openCount: 0,
  closeCount: 0,
  open(name, version) {
    const req = new FakeRequest();
    later(() => {
      if (fake.openError) { req._fail(new FakeDOMException("UnknownError", fake.openError)); return; }
      let data = databases.get(name);
      const wanted = version || 1;
      const upgrade = !data || data.version < wanted;
      if (!data) { data = { version: wanted, stores: new Map() }; databases.set(name, data); }
      const db = new FakeDatabase(name, data);
      if (upgrade) {
        data.version = wanted; db.version = wanted; db._upgrading = true;
        req.result = db;
        if (req.onupgradeneeded) req.onupgradeneeded({ target: req, oldVersion: 0, newVersion: wanted });
        db._upgrading = false;
      }
      req._succeed(db);
    });
    return req;
  },
  deleteDatabase(name) { const req = new FakeRequest(); later(() => { databases.delete(name); req._succeed(undefined); }); return req; },
  /** Direct read of a store's values, for assertions (no transaction). */
  dump(name, store) { const d = databases.get(name); const s = d && d.stores.get(store); return s ? Array.from(s.data.values()).map((v) => structuredClone(v)) : []; },
  reset() { databases.clear(); fake.quota = false; fake.openError = null; fake.puts = 0; fake.openCount = 0; fake.closeCount = 0; }
};

module.exports = fake;

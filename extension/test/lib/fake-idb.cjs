/*
 * A small in-memory IndexedDB for the offline tests: the subset that
 * common/runlog.js uses. Schema v2 needs more than a single string-keyed
 * store, so this fake now supports:
 *   - several object stores in one transaction, and a versionchange
 *     transaction during onupgradeneeded (req.transaction) so a migration
 *     can read one store and write another;
 *   - compound key paths (the "lines" store is keyed ["runId", "seq"]);
 *   - indexes (createIndex / store.index(name)) and cursors
 *     (store.openCursor / index.openCursor, cursor.continue / update), with
 *     IDBKeyRange.only / bound, and store.delete over a key or a key range
 *     (what deleteLines uses: one request for every line of a run);
 *   - the real oldVersion in onupgradeneeded, so a v1 database upgrades to
 *     v2 and the migration runs.
 * Only the methods common/runlog.js calls exist here, so a call the real
 * database would accept but this fake lacks fails the test loudly.
 * Requests complete on a macrotask, as in a browser, so a promise
 * continuation that issues the next request keeps the transaction alive;
 * the transaction completes once no request is pending after that.
 *
 * `fake.quota = true` makes every put fail with a QuotaExceededError (the
 * transaction aborts with it), to check that the worker treats a full
 * database as a logged nuisance and not as a job failure. `fake.openError`
 * makes open() fail. `fake.reset()` empties every database; the data lives
 * in this module, so a fresh worker instance sees what the old one wrote.
 */
"use strict";

const databases = new Map(); // name -> { version, stores: Map(name -> store) }

class FakeDOMException extends Error {
  constructor(name, message) { super(message || name); this.name = name; }
}

// A macrotask (as a browser's request callbacks are), without setTimeout's
// 1 ms floor: the worker harness samples storage 10 ms after a message.
const later = (fn) => setImmediate(fn);

/* ------------------------------------------------------------ keys */

/** Extract a store's key from a value, honouring an array (compound) key path. */
function extractKey(keyPath, value) {
  if (Array.isArray(keyPath)) return keyPath.map((p) => value[p]);
  return value[keyPath];
}
/** Extract an index's key from a value. */
function indexKey(keyPath, value) {
  if (Array.isArray(keyPath)) return keyPath.map((p) => value[p]);
  return value[keyPath];
}
/** A stable, injective string for a key (number, string or array), for Map storage. */
function skey(key) {
  return JSON.stringify(Array.isArray(key) ? ["a", key] : ["v", key]);
}
/** IndexedDB key ordering for the values we store (number < string < array). */
function typeRank(v) { return Array.isArray(v) ? 3 : typeof v === "string" ? 2 : typeof v === "number" ? 1 : 0; }
function cmp(a, b) {
  const ra = typeRank(a), rb = typeRank(b);
  if (ra !== rb) return ra - rb;
  if (ra === 3) {
    const n = Math.min(a.length, b.length);
    for (let i = 0; i < n; i++) { const c = cmp(a[i], b[i]); if (c) return c; }
    return a.length - b.length;
  }
  return a < b ? -1 : a > b ? 1 : 0;
}

class FakeKeyRange {
  constructor(lower, upper, lowerOpen, upperOpen) { this.lower = lower; this.upper = upper; this.lowerOpen = !!lowerOpen; this.upperOpen = !!upperOpen; }
  includes(key) {
    if (this.lower !== undefined) { const c = cmp(key, this.lower); if (c < 0 || (c === 0 && this.lowerOpen)) return false; }
    if (this.upper !== undefined) { const c = cmp(key, this.upper); if (c > 0 || (c === 0 && this.upperOpen)) return false; }
    return true;
  }
}
const IDBKeyRange = {
  only: (v) => new FakeKeyRange(v, v, false, false),
  bound: (lo, hi, loOpen, hiOpen) => new FakeKeyRange(lo, hi, loOpen, hiOpen)
};
function rangeIncludes(range, key) {
  if (range === undefined || range === null) return true;
  if (range instanceof FakeKeyRange) return range.includes(key);
  return cmp(key, range) === 0; // a bare key acts as IDBKeyRange.only
}

/* ------------------------------------------------------------ requests */

class FakeRequest {
  constructor() { this.result = undefined; this.error = null; this.onsuccess = null; this.onerror = null; this.onupgradeneeded = null; this.onblocked = null; this.transaction = null; this.readyState = "pending"; }
  _succeed(value) { this.result = value; this.readyState = "done"; if (this.onsuccess) this.onsuccess({ target: this }); }
  _fail(error) { this.error = error; this.readyState = "done"; if (this.onerror) this.onerror({ target: this }); }
}

class FakeTransaction {
  constructor(db, storeNames, mode) {
    this.db = db; this.mode = mode; this.error = null; this.oncomplete = null; this.onerror = null; this.onabort = null;
    this._names = Array.isArray(storeNames) ? storeNames.slice() : [storeNames];
    this._versionchange = mode === "versionchange";
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
    if (!this._versionchange && !this._names.includes(name)) throw new FakeDOMException("NotFoundError", `store ${name} not in this transaction`);
    const store = this.db._data.stores.get(name);
    if (!store) throw new FakeDOMException("NotFoundError", `no store ${name}`);
    return new FakeStore(this, name, store);
  }
  abort() {
    if (this._finished) throw new FakeDOMException("InvalidStateError", "transaction finished");
    this._finished = true;
    later(() => { if (this.onabort) this.onabort({ target: this }); });
  }
  /** Run `fn()` on a macrotask as one request; the returned request fires onsuccess/onerror. */
  _request(fn) {
    if (this._finished) throw new FakeDOMException("TransactionInactiveError", "transaction finished");
    const req = new FakeRequest();
    req.transaction = this;
    fake.requests += 1;
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
  /**
   * A cursor over `list` ({ skey, key, primaryKey, value }), newest request
   * reused across continue(). Each step holds the transaction alive the way
   * a pending request does, so a continue() issued in onsuccess never lets
   * the transaction complete between rows.
   */
  _cursor(store, list) {
    const req = new FakeRequest();
    req.transaction = this;
    let pos = 0;
    const advance = () => {
      if (this._finished) throw new FakeDOMException("TransactionInactiveError", "transaction finished");
      fake.requests += 1; // every cursor step is a request round trip, as in a browser
      this._pending += 1;
      later(() => {
        this._pending -= 1;
        if (this._finished) return;
        if (pos >= list.length) { req._succeed(null); later(() => this._maybeComplete()); return; }
        const item = list[pos];
        const cursor = {
          key: item.key, primaryKey: item.primaryKey, value: structuredClone(item.value),
          continue: () => { pos += 1; advance(); },
          update: (v) => this._request(() => {
            const key = extractKey(store.keyPath, v);
            if (skey(key) !== item.skey) throw new FakeDOMException("DataError", "cursor update changed the key");
            store.data.set(item.skey, { key, value: structuredClone(v) });
            return key;
          })
        };
        req._succeed(cursor);
        later(() => this._maybeComplete());
      });
    };
    advance();
    return req;
  }
}

class FakeIndex {
  constructor(store, meta) { this._store = store; this.keyPath = meta.keyPath; }
  _sorted(range) {
    const out = [];
    for (const [sk, entry] of this._store._store.data) {
      const ik = indexKey(this.keyPath, entry.value);
      if (!rangeIncludes(range, ik)) continue;
      out.push({ skey: sk, key: ik, primaryKey: entry.key, value: entry.value });
    }
    out.sort((a, b) => cmp(a.key, b.key) || cmp(a.primaryKey, b.primaryKey));
    return out;
  }
  openCursor(range) { return this._store.tx._cursor(this._store._store, this._sorted(range)); }
}

class FakeStore {
  constructor(tx, name, store) { this.tx = tx; this.name = name; this.keyPath = store.keyPath; this._store = store; }
  _write(fn) {
    if (this.tx.mode === "readonly") throw new FakeDOMException("ReadOnlyError", "read-only transaction");
    return this.tx._request(fn);
  }
  _entries() {
    const out = [];
    for (const [sk, entry] of this._store.data) out.push({ skey: sk, key: entry.key, primaryKey: entry.key, value: entry.value });
    out.sort((a, b) => cmp(a.key, b.key));
    return out;
  }
  index(name) {
    const meta = this._store.indexes && this._store.indexes.get(name);
    if (!meta) throw new FakeDOMException("NotFoundError", `no index ${name}`);
    return new FakeIndex(this, meta);
  }
  createIndex(name, keyPath, opts) {
    if (!this.tx._versionchange) throw new FakeDOMException("InvalidStateError", "not in a versionchange transaction");
    if (!this._store.indexes) this._store.indexes = new Map();
    this._store.indexes.set(name, { keyPath, unique: !!(opts && opts.unique) });
    return new FakeIndex(this, { keyPath });
  }
  get(key) { return this.tx._request(() => { const e = this._store.data.get(skey(key)); return e ? structuredClone(e.value) : undefined; }); }
  getAll() { return this.tx._request(() => this._entries().map((e) => structuredClone(e.value))); }
  getAllKeys() { return this.tx._request(() => this._entries().map((e) => e.key)); }
  count() { return this.tx._request(() => this._store.data.size); }
  openCursor() { return this.tx._cursor(this._store, this._entries()); }
  put(value) {
    return this._write(() => {
      if (fake.quota) throw new FakeDOMException("QuotaExceededError", "The quota has been exceeded.");
      const key = extractKey(this.keyPath, value);
      if (key === undefined || (Array.isArray(key) && key.some((k) => k === undefined))) throw new FakeDOMException("DataError", "no key");
      this._store.data.set(skey(key), { key, value: structuredClone(value) });
      fake.puts += 1;
      return key;
    });
  }
  /** Delete one key, or every key inside an IDBKeyRange (one request, as in a browser). */
  delete(keyOrRange) {
    return this._write(() => {
      if (keyOrRange instanceof FakeKeyRange) {
        for (const [sk, entry] of Array.from(this._store.data)) if (keyOrRange.includes(entry.key)) this._store.data.delete(sk);
      } else {
        this._store.data.delete(skey(keyOrRange));
      }
      return undefined;
    });
  }
}

class FakeDatabase {
  constructor(name, data) { this.name = name; this._data = data; this.version = data.version; this.closed = false; fake.openCount += 1; }
  get objectStoreNames() { const names = Array.from(this._data.stores.keys()); return { contains: (n) => names.includes(n), length: names.length, [Symbol.iterator]: () => names[Symbol.iterator]() }; }
  createObjectStore(name, opts) {
    if (!this._upgrading) throw new FakeDOMException("InvalidStateError", "not in a versionchange transaction");
    const store = { keyPath: (opts && opts.keyPath) || null, data: new Map(), indexes: new Map() };
    this._data.stores.set(name, store);
    this._vtx._names.push(name);
    return new FakeStore(this._vtx, name, store);
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
  requests: 0, // request round trips (every store/index request and every cursor step)
  openCount: 0,
  closeCount: 0,
  IDBKeyRange,
  open(name, version) {
    const req = new FakeRequest();
    later(() => {
      if (fake.openError) { req._fail(new FakeDOMException("UnknownError", fake.openError)); return; }
      let data = databases.get(name);
      const wanted = version || 1;
      const oldVersion = data ? data.version : 0;
      const upgrade = !data || data.version < wanted;
      if (!data) { data = { version: 0, stores: new Map() }; databases.set(name, data); }
      const db = new FakeDatabase(name, data);
      if (upgrade) {
        data.version = wanted; db.version = wanted;
        // The versionchange transaction spans every store (existing and any
        // created during the upgrade); onupgradeneeded runs synchronously
        // and may queue requests (a migration cursor), so onsuccess waits
        // for that transaction to complete.
        const vtx = new FakeTransaction(db, Array.from(data.stores.keys()), "versionchange");
        db._upgrading = true; db._vtx = vtx;
        req.result = db;
        req.transaction = vtx;
        vtx.oncomplete = () => { db._upgrading = false; db._vtx = null; req.transaction = null; req._succeed(db); };
        vtx.onabort = () => { if (req.onerror) req._fail(vtx.error || new FakeDOMException("AbortError", "upgrade aborted")); };
        if (req.onupgradeneeded) req.onupgradeneeded({ target: req, oldVersion, newVersion: wanted });
        later(() => vtx._maybeComplete());
      } else {
        req._succeed(db);
      }
    });
    return req;
  },
  /** Direct read of a store's values, for assertions (no transaction). */
  dump(name, store) { const d = databases.get(name); const s = d && d.stores.get(store); return s ? Array.from(s.data.values()).map((e) => structuredClone(e.value)) : []; },
  reset() { databases.clear(); fake.quota = false; fake.openError = null; fake.puts = 0; fake.requests = 0; fake.openCount = 0; fake.closeCount = 0; }
};

module.exports = fake;

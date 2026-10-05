// Keeps one note in step with the signed-in person's cloud document,
// merging edits from other devices instead of overwriting them.
//
// Each cloud write carries a fresh `nonce` and a short `lineage` (the
// nonces it was built on). That tells a device whether an incoming version
// already includes what it last synced, so it can do a proper three-way
// merge, and lets it recognise echoes of its own writes.
//
// The engine talks to the cloud through a small document adapter
// ({ get, set, onSnapshot }, see cloud.js) and expects these error codes:
// "unavailable" (transient), "resource_exhausted" (slow down),
// "revoked" (access gone) and "invalid_argument" (write refused).

import { appendNote, merge3, unionMerge } from "./merge.js";
import { readVersion } from "./storage.js";

const LINEAGE = 24;
const HISTORY = 16;
const IDLE_MS = 900; // save after a short pause in typing
const MAX_WAIT_MS = 4000; // and at least this often while typing nonstop
const SLOW_WRITE_MS = 8000; // a write still pending this long means we're offline

const TERMINAL = new Set(["revoked", "not_granted", "capability_disabled", "capability_removed"]);

const sleep = (ms) => new Promise((r) => setTimeout(r, Math.max(0, ms)));
const codeOf = (e) => (e && typeof e.code === "string" ? e.code : "unavailable");
const byteSize = (obj) => new TextEncoder().encode(JSON.stringify(obj)).length;
const newNonce = () =>
  typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 12);

export class CloudSync {
  constructor({ ref, maxBytes = 250_000, getText, setText, persist, onStatus }) {
    this.ref = ref;
    this.maxBytes = maxBytes;
    this.getText = getText;
    this.setText = setText;
    this.persistFn = persist;
    this.onStatus = onStatus;

    this.base = null; // cloud version the editor was last in step with
    this.baseSeq = 0;
    this.history = new Map(); // nonce -> text of versions seen this visit
    this.seen = new Set();
    this.mine = new Set(); // nonces this page wrote

    this.state = "connecting";
    this.writing = null; // in-flight write promise
    this.again = false;
    this.idleTimer = null;
    this.maxTimer = null;
    this.retryTimer = null;
    this.retryMs = 0;
    this.unsub = null;
    this.closed = false;
    this.stopped = false;
    this.composing = false;
    this.queued = null;
    this.mergeWrites = 0; // writes caused by incoming merges since the last keystroke
    this.parkedText = null; // text that cannot be saved (too big)
  }

  // ---- lifecycle -------------------------------------------------------

  // `cached`: this account's local copy, if any. `fromBrowserNote`: the
  // editor currently holds the signed-out browser note, which is added to
  // the account's note.
  async start({ cached, fromBrowserNote }) {
    this.emit("connecting");
    if (cached && cached.base) {
      this.base = cached.base;
      this.remember(cached.base);
    }
    const snap = await this.call(() => this.ref.get());
    if (this.closed) return;
    const remote = readVersion(snap.exists ? snap.data() : null);

    const editorNow = this.getText();
    const accountText = fromBrowserNote ? (cached ? cached.text : null) : editorNow;
    let merged;
    if (accountText === null) merged = remote ? remote.text : "";
    else if (!remote) merged = accountText;
    else merged = this.mergeWith(accountText, remote);
    if (remote) {
      this.remember(remote);
      this.setBase(remote);
    }
    if (fromBrowserNote) merged = appendNote(merged, editorNow);

    if (merged !== this.getText()) this.setText(merged);
    this.persist();
    this.subscribe();
    if (this.dirty()) this.flush();
    else this.emit("saved", this.base ? this.base.updatedAt : 0);
  }

  close() {
    this.closed = true;
    clearTimeout(this.idleTimer);
    clearTimeout(this.maxTimer);
    clearTimeout(this.retryTimer);
    if (this.unsub) this.unsub();
    this.unsub = null;
  }

  // Push whatever is unsaved, waiting briefly. Resolves true when the
  // cloud has everything.
  async drain(timeoutMs = 4000) {
    const deadline = Date.now() + timeoutMs;
    for (let i = 0; i < 4 && Date.now() < deadline; i++) {
      if (this.writing) {
        await Promise.race([this.writing, sleep(deadline - Date.now())]);
        continue;
      }
      if (!this.dirty() || this.stopped || this.closed) break;
      await Promise.race([this.flush(), sleep(deadline - Date.now())]);
    }
    this.persist();
    return !this.dirty();
  }

  // ---- editor hooks ----------------------------------------------------

  touch() {
    this.mergeWrites = 0;
    if (this.stopped || this.closed) return;
    if (this.parkedText !== null && this.getText() !== this.parkedText) this.parkedText = null;
    if (this.state === "saved" || this.state === "connecting") this.emit("pending");
    this.schedule();
  }

  setComposing(on) {
    this.composing = on;
    if (!on && this.queued) {
      const snap = this.queued;
      this.queued = null;
      this.incoming(snap);
    }
  }

  // Check the cloud now (tab shown again, back online).
  async refresh() {
    if (this.closed || this.stopped) return;
    try {
      const snap = await this.call(() => this.ref.get());
      this.incoming(snap);
      if (this.dirty()) await this.flush();
      else if (this.state !== "saved") this.emit("saved", this.base ? this.base.updatedAt : 0);
    } catch (e) {
      this.fail(e);
    }
  }

  // ---- incoming versions ----------------------------------------------

  subscribe() {
    if (this.unsub || this.closed || this.stopped) return;
    this.unsub = this.ref.onSnapshot(
      (snap) => {
        const meta = snap.metadata || {};
        if (meta.fromCache || meta.hasPendingWrites) return; // wait for the server's word
        this.incoming(snap);
      },
      (err) => {
        this.unsub = null;
        const code = codeOf(err);
        if (TERMINAL.has(code) || code === "invalid_argument") return this.stop("stopped");
        setTimeout(() => this.subscribe(), code === "resource_exhausted" ? 30000 : 3000);
      },
    );
  }

  incoming(snap) {
    if (this.closed || this.stopped) return;
    if (this.composing) {
      this.queued = snap; // apply once the input method finishes
      return;
    }
    const remote = readVersion(snap && snap.exists ? snap.data() : null);
    if (!remote) return;
    if (this.base && remote.nonce === this.base.nonce) return;
    if (this.mine.has(remote.nonce)) {
      if (!this.base || remote.updatedAt >= this.base.updatedAt) {
        this.setBase(remote);
        this.persist();
      }
      return;
    }
    if (this.seen.has(remote.nonce)) return; // already merged
    if (this.base && this.base.lineage.includes(remote.nonce)) return; // older than ours

    this.remember(remote);
    const editor = this.getText();
    const merged = this.mergeWith(editor, remote);
    this.setBase(remote);
    if (merged !== editor) this.setText(merged);
    this.persist();
    if (merged !== remote.text) {
      // Guard against two devices bouncing merges back and forth.
      if (++this.mergeWrites <= 3) this.schedule(400);
    } else {
      this.emit("saved", remote.updatedAt);
    }
  }

  mergeWith(localText, remote) {
    if (localText === remote.text) return localText;
    const ancestor = this.ancestorOf(remote);
    return ancestor !== null ? merge3(ancestor, localText, remote.text) : unionMerge(localText, remote.text);
  }

  // The newest version both this editor and `remote` were built from.
  ancestorOf(remote) {
    const base = this.base;
    if (!base) return null;
    if (remote.nonce === base.nonce || remote.lineage.includes(base.nonce)) return base.text;
    for (const n of remote.lineage) {
      const t = this.history.get(n);
      if (t !== undefined) return t;
    }
    return null;
  }

  // ---- outgoing writes -------------------------------------------------

  dirty() {
    const text = this.getText();
    if (this.parkedText !== null && text === this.parkedText) return false;
    return this.base ? text !== this.base.text : text !== "";
  }

  schedule(delay = IDLE_MS) {
    if (this.closed || this.stopped) return;
    clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => this.flush(), delay);
    if (!this.maxTimer) this.maxTimer = setTimeout(() => this.flush(), MAX_WAIT_MS);
  }

  flush() {
    clearTimeout(this.idleTimer);
    clearTimeout(this.maxTimer);
    this.idleTimer = null;
    this.maxTimer = null;
    if (this.closed || this.stopped) return Promise.resolve();
    if (this.composing) {
      this.schedule(500);
      return Promise.resolve();
    }
    if (this.writing) {
      this.again = true;
      return this.writing;
    }
    if (!this.dirty()) {
      if (this.state === "pending" || this.state === "saving") this.emit("saved", this.base ? this.base.updatedAt : 0);
      return Promise.resolve();
    }
    this.writing = this.write().finally(() => {
      this.writing = null;
      if (this.closed || this.stopped || this.retryTimer) return;
      if (this.again || this.dirty()) {
        this.again = false;
        this.schedule(250);
      }
    });
    return this.writing;
  }

  async write() {
    this.emit("saving");
    try {
      // Pick up anything another device saved first, so it is merged in
      // rather than overwritten.
      const snap = await this.call(() => this.ref.get());
      if (this.closed) return;
      this.incoming(snap);
      if (!this.dirty()) {
        this.emit("saved", this.base ? this.base.updatedAt : 0);
        return;
      }
      const text = this.getText();
      const version = {
        v: 1,
        text,
        nonce: newNonce(),
        lineage: this.base ? [this.base.nonce, ...this.base.lineage].slice(0, LINEAGE) : [],
        updatedAt: Date.now(),
      };
      if (byteSize(version) > this.maxBytes) {
        this.parkedText = text;
        this.emit("too-big");
        return;
      }
      this.mine.add(version.nonce);
      this.remember(version);
      const seq = this.baseSeq;
      // Some stores hold a write open until they are back online; say so.
      const slow = setTimeout(() => this.emit("offline"), SLOW_WRITE_MS);
      try {
        await this.call(() => this.ref.set(version));
      } finally {
        clearTimeout(slow);
      }
      if (this.closed) return;
      if (this.baseSeq === seq) this.setBase(version);
      this.retryMs = 0;
      this.persist();
      this.emit(this.dirty() ? "pending" : "saved", version.updatedAt);
    } catch (e) {
      this.fail(e);
    }
  }

  // One quick retry for a transient failure.
  async call(fn) {
    try {
      return await fn();
    } catch (e) {
      if (codeOf(e) !== "unavailable") throw e;
      await sleep(300 + Math.random() * 700);
      return await fn();
    }
  }

  fail(e) {
    if (this.closed) return;
    const code = codeOf(e);
    if (TERMINAL.has(code) || code === "invalid_argument") return this.stop("stopped");
    // Offline, rate-limited or a passing outage: retry with backoff.
    this.retryMs = Math.min(60000, this.retryMs ? this.retryMs * 2 : 4000);
    this.emit("offline");
    clearTimeout(this.retryTimer);
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.refresh();
    }, this.retryMs);
  }

  stop(state) {
    this.stopped = true;
    clearTimeout(this.idleTimer);
    clearTimeout(this.maxTimer);
    clearTimeout(this.retryTimer);
    if (this.unsub) this.unsub();
    this.unsub = null;
    this.persist();
    this.emit(state);
  }

  // ---- bookkeeping -----------------------------------------------------

  setBase(v) {
    this.base = v;
    this.baseSeq++;
  }

  remember(v) {
    this.seen.add(v.nonce);
    this.history.set(v.nonce, v.text);
    while (this.history.size > HISTORY) this.history.delete(this.history.keys().next().value);
  }

  persist() {
    if (!this.closed) this.persistFn(this.getText(), this.base);
  }

  emit(state, at) {
    if (this.closed) return;
    this.state = state;
    this.onStatus({ state, at: at || 0 });
  }
}

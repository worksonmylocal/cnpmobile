const test = require("node:test");
const assert = require("node:assert/strict");
const { SyncEngine, REFRESH_EVERY_MS } = require("../.test-build/syncEngine");
const { WriteQueue } = require("../.test-build/queue");
const { ApiError } = require("../.test-build/net");

const adapt = (kv) => ({ get: (k) => kv.getItem(k), set: (k, v) => kv.setItem(k, v) });
const memKV = () => { const m = new Map(); return { m, getItem: async (k) => m.get(k) ?? null, setItem: async (k, v) => void m.set(k, v), removeItem: async (k) => void m.delete(k) }; };

function rig({ programmes = [{ name: "FP1" }], bootstrap, selected = "FP1", store = memKV(), kv = memKV() } = {}) {
  const t = { now: 5_000_000 };
  const timers = []; const requests = []; const saved = []; const events = [];
  let cooldownUntil = 0;
  const queue = new WriteQueue(kv, () => t.now, () => 0.5);
  const prog = { sel: selected };
  const net = {
    request: async (method, args) => {
      requests.push({ method, args });
      if (bootstrap) return bootstrap(method, args, requests.length);
      return { programmes, home: { a: 1 }, plans_by_section: {}, store_requests: [] };
    },
    cooldownMs: () => Math.max(0, cooldownUntil - t.now),
    clearCooldown: () => { cooldownUntil = 0; },
  };
  const engine = new SyncEngine({
    now: () => t.now, user: () => "u@x", net, queue,
    cache: { setMany: async (u, items) => void saved.push(items) },
    send: async (i) => { events.push(["send", i.id]); },
    programme: {
      current: () => prog.sel,
      reconcile: async (opts) => { if (prog.sel && !opts.some((o) => o.name === prog.sel)) prog.sel = null; if (!prog.sel && opts.length === 1) prog.sel = opts[0].name; return prog.sel; },
      fold: (p, a) => (p ? { ...(a || {}), programme: p } : { ...(a || {}) }),
    },
    store: adapt(store),
    timers: { set: (fn, ms) => { const h = { fn, at: t.now + ms, ms }; timers.push(h); return h; }, clear: (h) => { const i = timers.indexOf(h); if (i >= 0) timers.splice(i, 1); } },
    onAuthExpired: (v) => events.push(["auth", v]),
  });
  return { engine, t, timers, requests, saved, queue, prog, events, setCooldown: (ms) => { cooldownUntil = t.now + ms; }, store, kv };
}
const methods = (r) => r.requests.map((q) => q.method);

test("first run: one bootstrap call, saved, and the next refresh is scheduled ~10 minutes out", async () => {
  const r = rig(); r.engine.start(); await r.engine.syncNow();
  assert.equal(r.engine.state.lastError, null, "no error was swallowed");
  assert.deepEqual(methods(r), ["get_field_bootstrap"]);
  assert.deepEqual(r.requests[0].args, { programme: "FP1" });
  assert.equal(r.saved.length >= 1, true);
  assert.equal(r.engine.state.lastSyncAt, r.t.now);
  assert.equal(r.engine.state.syncing, false);
  const next = r.timers[r.timers.length - 1];
  assert.equal(next.ms > 9 * 60_000 && next.ms <= REFRESH_EVERY_MS, true, "next in " + next.ms);
});

test("a second sync soon after asks the server for NOTHING", async () => {
  const r = rig(); await r.engine.syncNow(); const before = r.requests.length;
  r.t.now += 2 * 60_000; await r.engine.syncNow(); await r.engine.syncNow();
  assert.equal(r.requests.length, before);
});

test("a person pulling to refresh (force) always refreshes", async () => {
  const r = rig(); await r.engine.syncNow(); r.t.now += 1000;
  await r.engine.syncNow({ force: true });
  assert.equal(methods(r).filter((m) => m === "get_field_bootstrap").length, 2);
});

test("after ten minutes the copy is refreshed again; before that it is not", async () => {
  const r = rig(); await r.engine.syncNow();
  r.t.now += REFRESH_EVERY_MS - 1000; await r.engine.syncNow(); assert.equal(r.requests.length, 1);
  r.t.now += 2000; await r.engine.syncNow(); assert.equal(r.requests.length, 2);
});

test("a restart within ten minutes does not refresh again (the last refresh time is remembered)", async () => {
  const store = memKV(); const a = rig({ store }); await a.engine.syncNow();
  const b = rig({ store }); b.t.now = a.t.now + 3 * 60_000; await b.engine.syncNow();
  assert.equal(b.requests.length, 0);
});

test("a server without the bootstrap endpoint is handled: noted once, never asked again, screens fetch for themselves", async () => {
  const r = rig({ bootstrap: async () => { throw new ApiError("Failed to get method", "rejected", { missingMethod: true, status: 404 }); } });
  await r.engine.syncNow();
  assert.equal(r.engine.state.bootstrapUnsupported, true);
  r.t.now += REFRESH_EVERY_MS + 1; await r.engine.syncNow({ force: true }); await r.engine.syncNow();
  assert.equal(r.requests.length, 1, "asked once, then never");
});

test("waiting work is sent BEFORE the refresh, in order", async () => {
  const r = rig(); await r.queue.enqueue("u@x", "m1", {}, { id: "1" }); await r.queue.enqueue("u@x", "m2", {}, { id: "2" });
  await r.engine.syncNow();
  assert.deepEqual(r.events.filter((e) => e[0] === "send").map((e) => e[1]), ["1", "2"]);
  assert.equal(r.queue.pending("u@x").length, 0);
  assert.equal(methods(r)[0], "get_field_bootstrap");
});

test("a throttled queued item: no refresh is attempted, a retry is scheduled, the item stays", async () => {
  const r = rig();
  r.engine = r.engine; await r.queue.enqueue("u@x", "m", {}, { id: "1" });
  const engine = new SyncEngine({
    now: () => r.t.now, user: () => "u@x",
    net: { request: async () => { throw new Error("must not refresh"); }, cooldownMs: () => 0, clearCooldown() {} },
    queue: r.queue, cache: { setMany: async () => {} },
    send: async () => { throw new ApiError("busy", "throttled", { retryAfterMs: 90_000 }); },
    programme: { current: () => "FP1", reconcile: async () => "FP1", fold: (p, a) => ({ ...a, programme: p }) },
    store: adapt(memKV()),
    timers: { set: (fn, ms) => { const h = { fn, ms }; r.timers.push(h); return h; }, clear() {} },
  });
  engine.start(); await engine.syncNow();
  assert.equal(r.queue.pending("u@x").length, 1);
  assert.match(engine.state.lastError, /busy/);
  const last = r.timers[r.timers.length - 1];
  assert.equal(last.ms >= 90_000, true, "retry honours Retry-After: " + last.ms);
});

test("inside a server-requested cooldown nothing is sent, and the return is scheduled for when it ends", async () => {
  const r = rig(); r.setCooldown(120_000); await r.queue.enqueue("u@x", "m", {}, { id: "1" });
  r.engine.start(); await r.engine.syncNow();
  assert.equal(r.requests.length, 0); assert.equal(r.events.filter((e) => e[0] === "send").length, 0);
  assert.equal(r.timers[r.timers.length - 1].ms >= 120_000, true);
});

test("a person's force overrides a cooldown and goes ahead", async () => {
  const r = rig(); r.setCooldown(120_000); await r.queue.enqueue("u@x", "m", {}, { id: "1" });
  await r.engine.syncNow({ force: true });
  assert.equal(r.events.filter((e) => e[0] === "send").length, 1); assert.equal(methods(r).includes("get_field_bootstrap"), true);
});

test("an auth failure is reported, the work is kept, and no refresh is made", async () => {
  const r = rig(); await r.queue.enqueue("u@x", "m", {}, { id: "1" });
  const engine = new SyncEngine({
    now: () => r.t.now, user: () => "u@x",
    net: { request: async () => { throw new Error("no refresh"); }, cooldownMs: () => 0, clearCooldown() {} },
    queue: r.queue, cache: { setMany: async () => {} },
    send: async () => { throw new ApiError("bad token", "auth"); },
    programme: { current: () => null, reconcile: async () => null, fold: (p, a) => a },
    store: adapt(memKV()), timers: { set: () => ({}), clear() {} },
    onAuthExpired: (v) => r.events.push(["auth", v]),
  });
  await engine.syncNow();
  assert.deepEqual(r.events.filter((e) => e[0] === "auth").pop(), ["auth", true]);
  assert.equal(r.queue.pending("u@x").length, 1);
});

test("two programmes: each one is saved for offline use, not just the open one", async () => {
  const r = rig({ programmes: [{ name: "FP1" }, { name: "FP2" }], selected: "FP1" });
  await r.engine.syncNow();
  assert.deepEqual(r.requests.map((q) => q.args.programme), ["FP1", "FP2"]);
  assert.equal(r.saved.length, 2);
});

test("one programme and nothing selected yet: saved under the programme the screens will use, with no second request", async () => {
  const r = rig({ programmes: [{ name: "ONLY" }], selected: null });
  r.engine.state.lastSyncAt = 0; await r.engine.syncNow();
  assert.equal(r.requests.length, 1); assert.equal(r.prog.sel, "ONLY");
  assert.equal(r.saved.length, 2, "once unfolded, once under the chosen programme");
});

test("a burst of writes makes one sync, after the burst settles", async () => {
  const r = rig(); r.engine.start(); await r.engine.syncNow(); r.timers.length = 0;
  for (let i = 0; i < 6; i++) r.engine.kick();
  const kicks = r.timers.filter((h) => h.ms === 900);
  assert.equal(kicks.length, 1, "earlier kicks were replaced, not stacked");
});

test("in the background there are no timers and nothing polls; coming back to the front syncs", async () => {
  const r = rig(); r.engine.start(); await r.engine.syncNow();
  r.engine.setForeground(false);
  assert.equal(r.timers.length, 0);
  r.t.now += REFRESH_EVERY_MS + 1; const before = r.requests.length;
  r.engine.setForeground(true); await new Promise((x) => setTimeout(x, 5)); await r.engine.syncNow();
  assert.equal(r.requests.length > before, true);
});

test("a person's refresh during a quiet background sync is not swallowed", async () => {
  let release; const gate = new Promise((x) => (release = x));
  const r = rig({ bootstrap: async (m, a, n) => { if (n === 1) await gate; return { programmes: [{ name: "FP1" }] }; } });
  const first = r.engine.syncNow(); const forced = r.engine.syncNow({ force: true });
  release(); await Promise.all([first, forced]);
  assert.equal(r.requests.length, 2, "the forced refresh ran after the background one");
});

test("a failed refresh leaves the engine usable and scheduled, with the reason recorded", async () => {
  const r = rig({ bootstrap: async () => { throw new ApiError("No connection to the server.", "network"); } });
  r.engine.start(); await r.engine.syncNow();
  assert.equal(r.engine.state.syncing, false); assert.match(r.engine.state.lastError, /No connection/);
  assert.equal(r.timers.length > 0, true);
});

test("the volume: an hour of sitting open makes a handful of requests, not dozens", async () => {
  const r = rig(); r.engine.start(); await r.engine.syncNow();
  for (let minute = 1; minute <= 60; minute++) { r.t.now += 60_000; await r.engine.syncNow(); }
  assert.equal(r.requests.length <= 7, true, "requests in an hour: " + r.requests.length);
});

test("firstRun hands a waiting screen the refresh that is already under way, and nothing once one has happened", async () => {
  const r = rig();
  const p = r.engine.firstRun();
  assert.notEqual(p, null);
  await p;
  assert.equal(r.engine.firstRun(), null);
  assert.equal(r.requests.length, 1, "starting it twice did not ask twice");
});

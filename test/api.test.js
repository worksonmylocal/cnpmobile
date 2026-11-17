/**
 * The real API facade (cache-first reads, queued writes, error handling),
 * with only the phone's own storage and the network swapped for fakes.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");

/* ---- fakes for the platform modules the app imports ---------------------- */
const asyncStore = new Map();
const secure = new Map();
const fakes = {
  "@react-native-async-storage/async-storage": { __esModule: true, default: {
    getItem: async (k) => asyncStore.get(k) ?? null,
    setItem: async (k, v) => void asyncStore.set(k, v),
    removeItem: async (k) => void asyncStore.delete(k),
  } },
  "expo-secure-store": {
    getItemAsync: async (k) => secure.get(k) ?? null,
    setItemAsync: async (k, v) => void secure.set(k, v),
    deleteItemAsync: async (k) => void secure.delete(k),
  },
};
const realLoad = Module._load;
Module._load = function (request, ...rest) {
  if (fakes[request]) return fakes[request];
  return realLoad.call(this, request, ...rest);
};

/* ---- a controllable clock and server ------------------------------------ */
let clock = 1_800_000_000_000;
Date.now = () => clock;
const server = { calls: [], handler: null, down: false };
global.fetch = async (url, init) => {
  const method = url.split(".").pop();
  const args = JSON.parse(init.body || "{}");
  server.calls.push({ method, args, headers: init.headers });
  if (server.down) throw new TypeError("Network request failed");
  const r = server.handler(method, args, init);
  return { status: r.status ?? 200, headers: { get: (n) => (r.headers || {})[n.toLowerCase()] ?? null }, text: async () => r.text ?? JSON.stringify({ message: r.message }) };
};
const ok = (message) => ({ message });
const json = (status, o) => ({ status, text: JSON.stringify(o) });
const frappeErr = (status, msg) => json(status, { exc_type: "X", exception: "frappe.exceptions.X: " + msg, _server_messages: JSON.stringify([JSON.stringify({ message: msg })]) });

const api = require("../.test-build/api");
const core = require("../.test-build/core");
const auth = require("../.test-build/auth");

const SESSION = { api_key: "key1", api_secret: "sec1", user: "sup@lokitela.test", full_name: "Sup" };
async function signedIn() {
  // Each test starts as a freshly opened app: nothing in memory, nothing stored.
  core.cache.mem.clear();
  core.queue.items = []; core.queue.ready = null; core.queue.flushing = null;
  asyncStore.clear(); secure.clear(); server.calls.length = 0; server.down = false; clock += 10_000_000;
  recentlySentReset();
  core.net.clearCooldown();
  core.setAuthExpired(false);
  await auth.saveSession(SESSION);
  server.handler = () => ok(null);
  return SESSION.user;
}
function recentlySentReset() { clock += 400_000; }   // anything "recently sent" has aged out of the overlay
const callsTo = (m) => server.calls.filter((c) => c.method === m);

/* ------------------------------------------------------------------- reads */
test("a recent saved answer is used with NO request; an older one is fetched again", async () => {
  await signedIn(); server.handler = () => ok({ pending_requests: 1 });
  assert.deepEqual(await api.call("get_home_metrics"), { pending_requests: 1 });
  assert.deepEqual(await api.call("get_home_metrics"), { pending_requests: 1 });
  assert.equal(callsTo("get_home_metrics").length, 1, "second read came from the phone");
  clock += 120_000;                                    // older than the 90s trust for home figures
  server.handler = () => ok({ pending_requests: 2 });
  assert.deepEqual(await api.call("get_home_metrics"), { pending_requests: 2 });
  assert.equal(callsTo("get_home_metrics").length, 2);
});

test("with no signal, the last saved answer is still returned - flagged as stale, not an error", async () => {
  await signedIn(); server.handler = () => ok(["S1", "S2"]);
  await api.call("get_all_sections");
  clock += 7_200_000; server.down = true;              // two hours later, no network
  const r = await api.loadCached("get_all_sections");
  assert.deepEqual(r.data, ["S1", "S2"]); assert.equal(r.stale, true); assert.equal(r.fromCache, true); assert.equal(r.error.kind, "network");
});

test("nothing saved and no signal: a plain-words error, no status code", async () => {
  await signedIn(); server.down = true;
  await assert.rejects(api.call("get_all_sections"), (e) => e.kind === "network" && !/HTTP|\d{3}/.test(e.message));
});

test("a 429 with a saved answer: served from the phone, and NOTHING more is sent while the server says wait", async () => {
  await signedIn(); server.handler = () => ok("first");
  await api.call("get_store_requests");
  clock += 120_000;                                    // stale
  server.handler = () => ({ status: 429, text: "<html>Daily Usage Limit Reached</html>", headers: { "retry-after": "90" } });
  const r = await api.loadCached("get_store_requests");
  assert.equal(r.data, "first"); assert.equal(r.stale, true);
  const before = server.calls.length;
  for (const m of ["get_store_requests", "get_home_metrics", "get_all_sections", "get_block_progress"]) {
    await api.loadCached(m).catch(() => {});
  }
  assert.equal(server.calls.length, before, "no request reached the server during the cooldown");
  assert.equal(core.net.cooldownMs() >= 90_000, true);
  clock += 95_000;
  assert.equal(core.net.cooldownMs(), 0, "then it may ask again");
});

test("a 429 with nothing saved says the server is busy - and never mentions 429", async () => {
  await signedIn(); server.handler = () => ({ status: 429, text: "<html>busy</html>" });
  await assert.rejects(api.call("get_all_sections"), (e) => e.kind === "throttled" && /busy/i.test(e.message) && !/429/.test(e.message));
});

test("a rejected token is reported, but the session, saved data and queue are NOT touched", async () => {
  await signedIn(); server.handler = () => ok("data"); await api.call("get_all_sections");
  clock += 7_200_000; server.handler = () => frappeErr(401, "Invalid token");
  const r = await api.loadCached("get_all_sections");
  assert.equal(r.data, "data", "still shows what it had");
  assert.equal(core.isAuthExpired(), true);
  assert.equal(auth.currentSession().user, SESSION.user, "NOT signed out");
  assert.equal(secure.size, 1, "the saved sign-in is still stored");
});

test("a 403 permission answer is shown as written and does not sign anyone out", async () => {
  await signedIn(); server.handler = () => frappeErr(403, "You don't have access to Endebess.");
  await assert.rejects(api.writeCall("assign_block", { employee: "E", block: "B" }), (e) => e.kind === "permission" && e.message === "You don't have access to Endebess." && !e.queued);
  assert.equal(auth.currentSession().user, SESSION.user); assert.equal(core.isAuthExpired(), false);
});

test("a gateway/login HTML page with a 401 is not an expired sign-in", async () => {
  await signedIn(); server.handler = () => ({ status: 401, text: "<html>proxy auth</html>" });
  await assert.rejects(api.call("get_all_sections"));
  assert.equal(core.isAuthExpired(), false);
});

/* ------------------------------------------------------------------ writes */
test("a write goes out once, with a request id and the phone's date, and the things it changed are marked old", async () => {
  await signedIn(); server.handler = (m) => ok(m === "mark_attendance" ? { name: "A1" } : [{ block: "B", applicators: [], present: 0, absent: 0, unmarked: 0 }]);
  await api.call("get_attendance_by_block");
  const r = await api.writeCall("mark_attendance", { employee: "E1", status: "Present" });
  assert.deepEqual(r, { name: "A1" });
  const sent = callsTo("mark_attendance")[0].args;
  assert.match(sent.client_request_id, /^[a-z0-9]+-[a-z0-9]+$/); assert.match(sent.attendance_date, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(server.calls.find((c) => c.method === "mark_attendance").headers.Authorization, "token key1:sec1");
  const e = await core.cache.get(SESSION.user, "get_attendance_by_block", {});
  assert.equal(core.cache.isFresh(e, "get_attendance_by_block"), false, "register is now due a refetch");
});

test("a write with no signal is KEPT, says it is saved, and shows on screen at once", async () => {
  await signedIn();
  server.handler = () => ok([{ block: "B1", present: 0, absent: 0, unmarked: 1, applicators: [{ name: "E1", status: null }] }]);
  await api.call("get_attendance_by_block");
  server.down = true;
  await assert.rejects(api.writeCall("mark_attendance", { employee: "E1", status: "Present" }), (e) => e.queued === true && /saved/i.test(e.message));
  assert.equal(core.queue.pending(SESSION.user).length, 1);
  const view = await api.call("get_attendance_by_block");
  assert.equal(view[0].applicators[0].status, "Present", "the register already shows it"); assert.equal(view[0].present, 1);
});

test("the queued item is delivered later UNDER THE SAME REQUEST ID it first went out with", async () => {
  await signedIn(); server.down = true;
  await api.writeCall("create_store_request", { block_fertilizer_plan: "P1", quantity: 10 }, { meta: { block: "B1" } }).catch(() => {});
  const firstId = callsTo("create_store_request")[0].args.client_request_id;
  const item = core.queue.pending(SESSION.user)[0];
  assert.equal(item.id, firstId, "same id");
  server.down = false; server.calls.length = 0; server.handler = () => ok({ name: "MR-1" });
  const result = await core.queue.flush(SESSION.user, api.sendQueued);
  assert.equal(result.synced, 1); assert.equal(callsTo("create_store_request")[0].args.client_request_id, firstId);
  assert.equal(core.queue.pending(SESSION.user).length, 0);
});

test("a new write goes BEHIND waiting work (order is kept) and sends nothing", async () => {
  await signedIn(); server.down = true;
  await api.writeCall("mark_attendance", { employee: "E1", status: "Present" }).catch(() => {});
  server.down = false; server.calls.length = 0; server.handler = () => ok({});
  await assert.rejects(api.writeCall("mark_attendance", { employee: "E2", status: "Absent" }), (e) => e.queued === true);
  assert.equal(server.calls.length, 0, "not sent ahead of the older item");
  assert.deepEqual(core.queue.pending(SESSION.user).map((i) => i.args.employee), ["E1", "E2"]);
});

test("a write is not sent into a server that has asked us to wait - it is saved", async () => {
  await signedIn(); server.handler = () => ({ status: 429, text: "<html>x</html>", headers: { "retry-after": "60" } });
  await api.call("get_all_sections").catch(() => {});
  server.calls.length = 0;
  await assert.rejects(api.writeCall("mark_attendance", { employee: "E1", status: "Present" }), (e) => e.queued === true && /busy/i.test(e.message));
  assert.equal(server.calls.length, 0);
});

test("when the server refuses a write (validation), it is shown and NOT queued", async () => {
  await signedIn(); server.handler = () => frappeErr(417, "A reason is required when less than the planned quantity is applied.");
  await assert.rejects(api.writeCall("record_application", { block_fertilizer_plan: "P1", actual_quantity: 1 }), (e) => e.kind === "rejected" && !e.queued && /reason is required/.test(e.message));
  assert.equal(core.queue.pending(SESSION.user).length, 0);
});

test("a write that times out is kept, not lost - and goes again under the same id", async () => {
  await signedIn(); server.handler = () => { throw new TypeError("never"); }; server.down = true;
  await assert.rejects(api.writeCall("record_application", { block_fertilizer_plan: "P1", actual_quantity: 50 }, { meta: { section: "S", block: "B" } }), (e) => e.queued);
  const id = core.queue.pending(SESSION.user)[0].id;
  assert.equal(callsTo("record_application")[0].args.client_request_id, id);
  assert.match(core.queue.pending(SESSION.user)[0].args.application_date, /^\d{4}-\d{2}-\d{2}$/, "dated the day it was done");
});

test("'already recorded' on a repeat counts as success, not a failure to chase", async () => {
  await signedIn(); server.handler = () => frappeErr(417, "BLOCK 1 · CAN has already been recorded.");
  server.down = true;
  await api.writeCall("record_application", { block_fertilizer_plan: "P1", actual_quantity: 5 }).catch(() => {});
  server.down = false;
  const r = await core.queue.flush(SESSION.user, api.sendQueued);
  assert.equal(r.synced, 1); assert.equal(core.queue.failed(SESSION.user).length, 0);
});

test("waiting work is laid over reads without being written into the saved copy", async () => {
  await signedIn(); server.handler = () => ok([{ name: "P1", block: "B", request_status: null }]);
  await api.call("get_pending_plans_for_section", { section: "S" });
  server.down = true;
  await api.writeCall("create_store_request", { block_fertilizer_plan: "P1", quantity: 1 }).catch(() => {});
  const view = await api.call("get_pending_plans_for_section", { section: "S" });
  assert.equal(view[0].request_status, "Pending Approval");
  const raw = await core.cache.get(SESSION.user, "get_pending_plans_for_section", { section: "S" });
  assert.equal(raw.v[0].request_status, null, "the saved copy is still exactly what the server said");
});

test("work that was already sent is not applied twice to an answer fetched after it", async () => {
  await signedIn();
  server.handler = (m) => (m === "get_home_metrics" ? ok({ pending_requests: 1 }) : ok({ name: "MR" }));
  await api.call("get_home_metrics");
  await api.writeCall("create_store_request", { block_fertilizer_plan: "P1", quantity: 1 });
  clock += 1000;
  server.handler = (m) => ok({ pending_requests: 2 });          // the server already counts it
  const fresh = await api.call("get_home_metrics", undefined, { force: true });
  assert.equal(fresh.pending_requests, 2, "not 3");
});

/* ------------------------------------------------------------------- login */
test("wrong password is a plain message; it is not a session problem", async () => {
  await signedIn(); auth.clearSession && (await auth.clearSession());
  server.handler = () => frappeErr(401, "Incorrect user or password.");
  await assert.rejects(api.login("a@b", "x"), (e) => /Email or password is invalid/.test(e.message));
  assert.equal(server.calls[0].headers.Authorization, undefined, "login sends no token");
});

test("login that is being limited says how long to wait, and a second tap sends NOTHING", async () => {
  await signedIn(); await auth.clearSession();
  server.handler = () => ({ status: 429, text: JSON.stringify({ exc_type: "RateLimitExceededError", exception: "x" }), headers: { "retry-after": "120" } });
  await assert.rejects(api.login("a@b", "x"), (e) => /wait 2 minutes/.test(e.message) && e.retryAfterMs >= 120000);
  const n = server.calls.length;
  await assert.rejects(api.login("a@b", "x"), (e) => /wait/.test(e.message));
  assert.equal(server.calls.length, n, "no second attempt reached the server");
  // ...and the rest of the app is not held up by the login limit
  server.handler = () => ok("fine");
  await auth.saveSession(SESSION);
  assert.equal(await api.call("get_all_sections"), "fine");
});

test("a good login saves the session and adopts an old unsent queue", async () => {
  await signedIn(); await auth.clearSession();
  asyncStore.set("uc_offline_queue", JSON.stringify([{ method: "mark_attendance", args: { employee: "E9", status: "Present" }, ts: 1 }]));
  server.handler = () => ok(SESSION);
  const s = await api.login("sup@lokitela.test", "pw");
  assert.equal(s.user, SESSION.user); assert.equal(auth.currentSession().api_key, "key1");
  await core.queue.load(SESSION.user);
  assert.equal(core.queue.pending(SESSION.user).length >= 1, true);
});

test("one person's saved data is invisible to another on the same phone", async () => {
  await signedIn(); server.handler = () => ok("alice-data"); await api.call("get_all_sections");
  await auth.saveSession({ ...SESSION, user: "bob@lokitela.test", api_key: "kb", api_secret: "sb" });
  server.down = true;
  await assert.rejects(api.call("get_all_sections"), (e) => e.kind === "network", "bob has nothing saved and no signal");
  await auth.saveSession(SESSION);
  assert.equal(await api.call("get_all_sections"), "alice-data");
});

test("first launch: a screen with nothing saved waits for the one refresh instead of fetching alongside it", async () => {
  await signedIn();
  let release; const gate = new Promise((r) => (release = r));
  // the "refresh" saves what the screen wants, a moment later
  api.hooks.firstSync = () => gate;
  server.handler = (m) => ok("fetched-individually");
  const pending = api.call("get_all_sections");
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(server.calls.length, 0, "the screen did not fetch while the refresh was under way");
  await core.cache.set(SESSION.user, "get_all_sections", {}, "seeded-by-refresh");
  release();
  assert.equal(await pending, "seeded-by-refresh");
  assert.equal(server.calls.length, 0, "and never needed to");
  api.hooks.firstSync = undefined;
});

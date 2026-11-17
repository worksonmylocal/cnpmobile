const test = require("node:test");
const assert = require("node:assert/strict");
const { classify, NetClient, ApiError, parseRetryAfter, friendly } = require("../.test-build/net");

const body = (o) => JSON.stringify(o);
const frappeErr = (msg) => body({ exc_type: "X", exception: "frappe.exceptions.X: " + msg, _server_messages: JSON.stringify([JSON.stringify({ message: msg })]) });

/* ---------------------------------------------------------------- classify */
test("a JSON 200 is success and returns .message", () => {
  const r = classify(200, body({ message: { a: 1 } }));
  assert.equal(r.ok, true); assert.deepEqual(r.data, { a: 1 });
});
test("401 JSON is an auth failure - the only thing that means sign in again", () => {
  const r = classify(401, frappeErr("Invalid token"));
  assert.equal(r.error.kind, "auth"); assert.equal(r.error.transient, false);
});
test("401 that is NOT JSON (a gateway/login page) is never an auth failure", () => {
  const r = classify(401, "<html>Login</html>");
  assert.equal(r.error.kind, "unexpected"); assert.equal(r.error.transient, true);
});
test("403 JSON is a permission answer, shown as the server worded it", () => {
  const r = classify(403, frappeErr("Insufficient Permission for Material Request"));
  assert.equal(r.error.kind, "permission"); assert.equal(r.error.message, "Insufficient Permission for Material Request");
});
test("403 HTML is not 'permission' and not 'auth'", () => {
  assert.equal(classify(403, "<html>forbidden</html>").error.kind, "unexpected");
});
test("429 as JSON (the app's own limiter) and as an HTML page are both 'throttled'", () => {
  assert.equal(classify(429, frappeErr("rate limit")).error.kind, "throttled");
  assert.equal(classify(429, "<!doctype html><title>Daily Usage Limit Reached</title>").error.kind, "throttled");
});
test("5xx is a server problem whether or not it is JSON", () => {
  assert.equal(classify(502, "<html>Bad gateway</html>").error.kind, "server");
  assert.equal(classify(500, frappeErr("boom")).error.kind, "server");
});
test("a 200 HTML page (captive portal) is 'unexpected', transient", () => {
  const e = classify(200, "<html>Sign in to Wi-Fi</html>").error;
  assert.equal(e.kind, "unexpected"); assert.equal(e.transient, true);
});
test("validation errors are 'rejected' and never transient", () => {
  const e = classify(417, frappeErr("A reason is required")).error;
  assert.equal(e.kind, "rejected"); assert.equal(e.transient, false);
});
test("a missing method on an older server is recognised", () => {
  const e = classify(404, body({ exception: "frappe.exceptions.ValidationError: Failed to get method for command x" })).error;
  assert.equal(e.missingMethod, true);
});
test("Retry-After accepts seconds and dates", () => {
  assert.equal(parseRetryAfter("30"), 30000);
  assert.equal(parseRetryAfter(new Date(Date.now() + 60000).toUTCString()) > 50000, true);
  assert.equal(parseRetryAfter(null), undefined);
});
test("friendly() never shows a status code", () => {
  for (const kind of ["network", "throttled", "cooldown", "server", "unexpected", "auth"]) {
    const m = friendly(new ApiError("x", kind, { retryAfterMs: 20000 }), { saved: true });
    assert.doesNotMatch(m, /HTTP|\b429\b|\b50\d\b/);
  }
});

/* --------------------------------------------------------------- NetClient */
function harness(handler, extra = {}) {
  const t = { now: 1_000_000 };
  const calls = [];
  const client = new NetClient({
    fetch: async (url, init) => {
      calls.push({ url, init });
      return handler(url, init, calls.length);
    },
    baseUrl: () => "https://x.test",
    prefix: "/api/method/p.",
    auth: () => ({ key: "k", secret: "s" }),
    now: () => t.now,
    random: () => 0.5,                 // jitter factor exactly 1.0
    sleep: async (ms) => { t.now += ms; },
    ...extra,
  });
  return { client, t, calls };
}
const res = (status, text, headers = {}) => ({ status, text: async () => text, headers: { get: (n) => headers[n.toLowerCase()] ?? null } });
const ok = (message) => res(200, body({ message }));

test("sends the token and the arguments", async () => {
  const { client, calls } = harness(() => ok(1));
  await client.request("ping", { a: 1 });
  assert.equal(calls[0].url, "https://x.test/api/method/p.ping");
  assert.equal(calls[0].init.headers.Authorization, "token k:s");
  assert.equal(calls[0].init.body, '{"a":1}');
});

test("a 429 starts a cooldown, and while it lasts NOTHING is sent", async () => {
  const { client, calls, t } = harness(() => res(429, "<html>busy</html>"));
  await assert.rejects(client.request("a", {}), (e) => e.kind === "throttled");
  assert.equal(calls.length, 1);
  assert.equal(client.cooldownMs() > 0, true);
  for (const m of ["a", "b", "c"]) await assert.rejects(client.request(m, {}), (e) => e.kind === "cooldown" && e.retryAfterMs > 0);
  assert.equal(calls.length, 1, "no request reached the network during the cooldown");
  t.now += client.cooldownMs() + 1;
  assert.equal(client.cooldownMs(), 0);
});

test("Retry-After is honoured when it is longer than our own backoff", async () => {
  const { client } = harness(() => res(429, "x", { "retry-after": "120" }));
  await assert.rejects(client.request("a", {}));
  assert.equal(client.cooldownMs() >= 120000, true);
});

test("repeated throttling backs off for longer each time, up to a cap, and success resets it", async () => {
  let throttle = true;
  const { client, t } = harness(() => (throttle ? res(429, "x") : ok(1)));
  const seen = [];
  for (let i = 0; i < 9; i++) {
    await assert.rejects(client.request("a", {}));
    seen.push(client.cooldownMs());
    t.now += client.cooldownMs() + 1;
  }
  assert.equal(seen[1] > seen[0] && seen[2] > seen[1], true, "grows: " + seen);
  assert.equal(Math.max(...seen) <= 300000 * 1.25, true, "capped: " + seen);
  throttle = false;
  await client.request("a", {});
  throttle = true;
  await assert.rejects(client.request("a", {}));
  assert.equal(client.cooldownMs() <= seen[0] * 1.3, true, "back to the first step after a success");
});

test("an auth failure does not start a cooldown and does not touch anything else", async () => {
  const { client } = harness(() => res(401, frappeErr("Invalid token")));
  await assert.rejects(client.request("a", {}), (e) => e.kind === "auth");
  assert.equal(client.cooldownMs(), 0);
});

test("the login endpoint has its own cooldown and never blocks the rest of the app", async () => {
  let n = 0;
  const { client, calls } = harness((url) => (url.endsWith("mobile_login") ? res(429, frappeErr("limit")) : (n++, ok("fine"))));
  await assert.rejects(client.request("mobile_login", { usr: "a", pwd: "b" }, { login: true }), (e) => e.kind === "throttled");
  assert.equal(client.cooldownMs("login") > 0, true);
  assert.equal(client.cooldownMs("api"), 0);
  assert.equal(await client.request("get_x", {}), "fine");
  await assert.rejects(client.request("mobile_login", {}, { login: true }), (e) => e.kind === "cooldown");
  const loginCalls = calls.filter((c) => c.url.endsWith("mobile_login")).length;
  assert.equal(loginCalls, 1, "login was not retried inside its cooldown");
  assert.equal(calls.find((c) => c.url.endsWith("mobile_login")).init.headers.Authorization, undefined, "login sends no token");
});

test("reads retry a dropped connection a couple of times; writes never do", async () => {
  let fails = 2;
  const { client, calls } = harness(() => { if (fails-- > 0) throw new TypeError("Network request failed"); return ok("done"); });
  assert.equal(await client.request("a", {}), "done");
  assert.equal(calls.length, 3);

  const w = harness(() => { throw new TypeError("Network request failed"); });
  await assert.rejects(w.client.request("a", {}, { write: true }), (e) => e.kind === "network");
  assert.equal(w.calls.length, 1, "a write is tried once - the queue owns retries");
});

test("a 5xx is retried for reads but a throttle is not retried at all", async () => {
  const s = harness(() => res(502, "<html>bad gateway</html>"));
  await assert.rejects(s.client.request("a", {}));
  assert.equal(s.calls.length >= 2, true);
  const th = harness(() => res(429, "x"));
  await assert.rejects(th.client.request("a", {}));
  assert.equal(th.calls.length, 1);
});

test("identical reads made together share one request", async () => {
  let release; const gate = new Promise((r) => (release = r));
  const { client, calls } = harness(async () => { await gate; return ok("shared"); });
  const a = client.request("get_x", { s: 1 }), b = client.request("get_x", { s: 1 }), c = client.request("get_x", { s: 2 });
  await new Promise((r) => setTimeout(r, 5));
  release();
  assert.deepEqual(await Promise.all([a, b, c]), ["shared", "shared", "shared"]);
  assert.equal(calls.length, 2, "two distinct questions, two requests");
});

test("never more than the allowed number of requests in flight", async () => {
  let live = 0, peak = 0;
  const { client } = harness(async () => { live++; peak = Math.max(peak, live); await new Promise((r) => setTimeout(r, 15)); live--; return ok(1); }, { maxConcurrent: 3 });
  await Promise.all(Array.from({ length: 12 }, (_, i) => client.request("m" + i, {})));
  assert.equal(peak, 3);
});

test("a request that never answers is cut off and reported as a network failure", async () => {
  const { client } = harness((url, init) => new Promise((_, rej) => init.signal.addEventListener("abort", () => { const e = new Error("aborted"); e.name = "AbortError"; rej(e); })), { readTimeoutMs: 30 });
  await assert.rejects(client.request("a", {}, { retries: 0 }), (e) => e.kind === "network" && /too long/.test(e.message));
});

test("not signed in is an auth error and sends nothing", async () => {
  const { client, calls } = harness(() => ok(1), { auth: () => null });
  await assert.rejects(client.request("a", {}), (e) => e.kind === "auth");
  assert.equal(calls.length, 0);
});

test("two failures in a row from the server start a short cooldown", async () => {
  const { client } = harness(() => res(503, "<html>x</html>"));
  await assert.rejects(client.request("a", {}));
  assert.equal(client.cooldownMs() > 0, true);
});

test("a person's deliberate retry can override a cooldown", async () => {
  let throttle = true;
  const { client } = harness(() => (throttle ? res(429, "x") : ok("through")));
  await assert.rejects(client.request("a", {}));
  throttle = false;
  assert.equal(await client.request("a", {}, { ignoreCooldown: true }), "through");
});

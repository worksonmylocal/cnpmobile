const test = require("node:test");
const assert = require("node:assert/strict");
const { DataCache, ttlFor } = require("../.test-build/cache");
const { WriteQueue } = require("../.test-build/queue");
const { ApiError } = require("../.test-build/net");
const { applyOverlay, waitingStoreRequests } = require("../.test-build/overlay");
const { seedsFromBootstrap } = require("../.test-build/seed");
const { stableStringify } = require("../.test-build/util");

const memKV = () => {
  const m = new Map();
  return { m, getItem: async (k) => m.get(k) ?? null, setItem: async (k, v) => void m.set(k, v), removeItem: async (k) => void m.delete(k) };
};

/* ------------------------------------------------------------------- cache */
test("the key does not depend on argument order", () => {
  const c = new DataCache(memKV());
  assert.equal(c.key("u", "m", { a: 1, b: 2 }), c.key("u", "m", { b: 2, a: 1 }));
  assert.notEqual(c.key("u", "m", { a: 1 }), c.key("v", "m", { a: 1 }));
});
test("saved answers survive a restart (new instance, same storage) and are served from memory after", async () => {
  const kv = memKV(); let t = 1000;
  const c1 = new DataCache(kv, () => t);
  await c1.set("u", "get_home_metrics", { programme: "P" }, { x: 1 });
  const c2 = new DataCache(kv, () => t);
  assert.equal(c2.peek("u", "get_home_metrics", { programme: "P" }), null, "memory is empty after a restart");
  const e = await c2.get("u", "get_home_metrics", { programme: "P" });
  assert.deepEqual(e.v, { x: 1 });
  assert.notEqual(c2.peek("u", "get_home_metrics", { programme: "P" }), null, "now in memory");
});
test("fresh vs stale follows the per-method TTL", async () => {
  const kv = memKV(); let t = 0;
  const c = new DataCache(kv, () => t);
  await c.set("u", "get_home_metrics", {}, 1);
  const e = await c.get("u", "get_home_metrics", {});
  t = ttlFor("get_home_metrics") - 1; assert.equal(c.isFresh(e, "get_home_metrics"), true);
  t = ttlFor("get_home_metrics") + 1; assert.equal(c.isFresh(e, "get_home_metrics"), false);
  assert.equal(ttlFor("get_available_employees_for_team"), 0, "a search box is never served from cache as fresh");
});
test("invalidate keeps the data to show but marks it old, and only for the named methods", async () => {
  const c = new DataCache(memKV(), () => 5000);
  await c.set("u", "get_home_metrics", {}, "H");
  await c.set("u", "get_all_sections", {}, "S");
  await c.invalidate("u", ["get_home_metrics"]);
  const h = await c.get("u", "get_home_metrics", {}), s = await c.get("u", "get_all_sections", {});
  assert.equal(h.v, "H"); assert.equal(c.isFresh(h, "get_home_metrics"), false);
  assert.equal(c.isFresh(s, "get_all_sections"), true);
});
test("two people on one phone never see each other's data, and purge removes only one", async () => {
  const c = new DataCache(memKV());
  await c.set("a@x", "m", {}, "A"); await c.set("b@x", "m", {}, "B");
  assert.equal((await c.get("a@x", "m", {})).v, "A");
  await c.purge("a@x");
  assert.equal(await c.get("a@x", "m", {}), null);
  assert.equal((await c.get("b@x", "m", {})).v, "B");
});
test("subscribers hear which keys changed", async () => {
  const c = new DataCache(memKV()); const heard = [];
  c.subscribe((k) => heard.push(...k));
  await c.set("u", "m", { a: 1 }, 1);
  assert.deepEqual(heard, [c.key("u", "m", { a: 1 })]);
});
test("the store is capped, dropping the oldest", async () => {
  let t = 0; const kv = memKV(); const c = new DataCache(kv, () => ++t);
  for (let i = 0; i < 640; i++) await c.set("u", "m", { i }, i);
  assert.equal(await c.get("u", "m", { i: 0 }) === null || (await c.get("u", "m", { i: 0 })) === null, true, "oldest evicted");
  assert.equal((await c.get("u", "m", { i: 639 })).v, 639);
  assert.equal(kv.m.size <= 605, true, "storage is bounded: " + kv.m.size);
});

/* ------------------------------------------------------------------- queue */
const T = (kind, extra = {}) => new ApiError("x " + kind, kind, extra);

test("queued work survives a restart, in order, with its request id and date", async () => {
  const kv = memKV();
  const q1 = new WriteQueue(kv, () => Date.UTC(2026, 10, 9, 8, 0), () => 0.5);
  const a = await q1.enqueue("u", "mark_attendance", { employee: "1", status: "Present" }, { id: "id-a" });
  await q1.enqueue("u", "create_store_request", { block_fertilizer_plan: "P1", quantity: 5 }, { id: "id-b", meta: { block: "B1" } });
  const q2 = new WriteQueue(kv); await q2.load();
  assert.deepEqual(q2.pending("u").map((i) => i.id), ["id-a", "id-b"]);
  assert.equal(q2.pending("u")[1].meta.block, "B1");
  assert.match(a.date, /^\d{4}-\d{2}-\d{2}$/);
});

test("flush sends oldest first, under each item's own id, and empties the queue", async () => {
  const q = new WriteQueue(memKV()); const sent = [];
  await q.enqueue("u", "m1", { n: 1 }, { id: "1" }); await q.enqueue("u", "m2", { n: 2 }, { id: "2" });
  const r = await q.flush("u", async (i) => void sent.push(i.id));
  assert.deepEqual(sent, ["1", "2"]); assert.equal(r.synced, 2); assert.equal(q.pending("u").length, 0);
});

test("a transient failure stops the run, backs the item off, and does not touch later items", async () => {
  let now = 1_000_000; const q = new WriteQueue(memKV(), () => now, () => 0.5);
  await q.enqueue("u", "m1", {}, { id: "1" }); await q.enqueue("u", "m2", {}, { id: "2" });
  const sent = [];
  const r = await q.flush("u", async (i) => { sent.push(i.id); throw T("throttled", { retryAfterMs: 60000 }); });
  assert.deepEqual(sent, ["1"], "the second was not even tried");
  assert.equal(r.stopped, "transient");
  const first = q.pending("u")[0];
  assert.equal(first.attempts, 1); assert.equal(first.nextAt >= now + 60000, true, "Retry-After respected");
  // while it is backing off, another flush sends nothing
  const again = await q.flush("u", async (i) => void sent.push("again-" + i.id));
  assert.equal(again.synced, 0); assert.deepEqual(sent, ["1"]);
  // a person's "sync now" overrides the wait
  const forced = await q.flush("u", async (i) => void sent.push("forced-" + i.id), { ignoreBackoff: true });
  assert.equal(forced.synced, 2);
});

test("backoff grows with attempts", async () => {
  let now = 0; const q = new WriteQueue(memKV(), () => now, () => 0.5);
  await q.enqueue("u", "m", {}, { id: "1" });
  const gaps = [];
  for (let i = 0; i < 4; i++) {
    await q.flush("u", async () => { throw T("network"); }, { ignoreBackoff: true });
    gaps.push(q.pending("u")[0].nextAt - now);
  }
  assert.equal(gaps[1] > gaps[0] && gaps[2] > gaps[1], true, String(gaps));
});

test("a refusal parks the item as failed, never retries it, and carries on with the rest", async () => {
  const q = new WriteQueue(memKV()); const sent = [];
  await q.enqueue("u", "bad", {}, { id: "1" }); await q.enqueue("u", "good", {}, { id: "2" });
  const r = await q.flush("u", async (i) => { if (i.id === "1") throw T("rejected"); sent.push(i.id); });
  assert.deepEqual(sent, ["2"]); assert.equal(r.synced, 1);
  assert.equal(q.failed("u").length, 1); assert.equal(q.failed("u")[0].error, "x rejected");
  assert.equal(q.pending("u").length, 0);
  const again = await q.flush("u", async () => { throw new Error("must not be called"); });
  assert.equal(again.synced, 0);
  await q.retryFailed("u");
  assert.equal(q.pending("u").length, 1, "a person can put it back in line");
});

test("an auth failure stops everything but keeps the work waiting (not failed, not lost)", async () => {
  const q = new WriteQueue(memKV());
  await q.enqueue("u", "m1", {}, { id: "1" }); await q.enqueue("u", "m2", {}, { id: "2" });
  const r = await q.flush("u", async () => { throw T("auth"); });
  assert.equal(r.stopped, "auth"); assert.equal(q.pending("u").length, 2); assert.equal(q.failed("u").length, 0);
});

test("work is only ever sent as the user who made it", async () => {
  const q = new WriteQueue(memKV()); const sent = [];
  await q.enqueue("alice", "m", {}, { id: "a" }); await q.enqueue("bob", "m", {}, { id: "b" });
  await q.flush("bob", async (i) => void sent.push(i.id));
  assert.deepEqual(sent, ["b"]); assert.equal(q.pending("alice").length, 1);
});

test("two flushes at once do not send anything twice", async () => {
  const q = new WriteQueue(memKV()); let n = 0;
  await q.enqueue("u", "m", {}, { id: "1" });
  const slow = async () => { n++; await new Promise((r) => setTimeout(r, 20)); };
  await Promise.all([q.flush("u", slow), q.flush("u", slow), q.flush("u", slow)]);
  assert.equal(n, 1);
});

test("an old-format queue (no owner) is adopted by the user who signs in, then removed", async () => {
  const kv = memKV();
  kv.m.set("uc_offline_queue", JSON.stringify([{ method: "mark_attendance", args: { employee: "1", status: "Present" }, ts: 1700000000000 }]));
  const q = new WriteQueue(kv); await q.load("alice");
  assert.equal(q.pending("alice").length, 1); assert.equal(kv.m.has("uc_offline_queue"), false);
});

/* ----------------------------------------------------------------- overlay */
const attendance = () => [{ block: "B1", present: 0, absent: 0, unmarked: 2, applicators: [{ name: "E1", status: null }, { name: "E2", status: null }] }];
test("waiting attendance shows on the register and recounts the tallies, without mutating the input", () => {
  const data = attendance(); const copy = JSON.stringify(data);
  const out = applyOverlay("get_attendance_by_block", {}, data, [{ method: "mark_attendance", args: { employee: "E1", status: "Present" } }]);
  assert.equal(out[0].applicators[0].status, "Present"); assert.equal(out[0].present, 1); assert.equal(out[0].unmarked, 1);
  assert.equal(JSON.stringify(data), copy);
});
test("waiting attendance shows on the team screen", () => {
  const data = [{ section: "S", blocks: [{ block: "B", applicators: [{ name: "E1", attendance_status: null }] }] }];
  const out = applyOverlay("get_my_applicators_by_section", {}, data, [{ method: "mark_attendance", args: { employee: "E1", status: "Absent" } }]);
  assert.equal(out[0].blocks[0].applicators[0].attendance_status, "Absent");
});
test("a waiting store request marks the plan pending and bumps the home count", () => {
  const plans = [{ name: "P1", request_status: null }, { name: "P2", request_status: null }];
  const it = [{ method: "create_store_request", args: { block_fertilizer_plan: "P1" } }];
  const out = applyOverlay("get_pending_plans_for_section", {}, plans, it);
  assert.equal(out[0].request_status, "Pending Approval"); assert.equal(out[1].request_status, null);
  assert.equal(applyOverlay("get_home_metrics", {}, { pending_requests: 2 }, it).pending_requests, 3);
});
test("a waiting application leaves the ready lists and moves the home figures", () => {
  const it = [{ method: "record_application", args: { block_fertilizer_plan: "P1" }, meta: { section: "S", block: "B1" } }];
  assert.deepEqual(applyOverlay("get_pending_plans_for_section", {}, [{ name: "P1" }, { name: "P2" }], it).map((p) => p.name), ["P2"]);
  assert.deepEqual(applyOverlay("get_sections_with_issued_work", {}, [{ section: "S", pending_count: 1 }], it), []);
  assert.deepEqual(applyOverlay("get_sections_with_issued_work", {}, [{ section: "S", pending_count: 2 }], it), [{ section: "S", pending_count: 1 }]);
  assert.deepEqual(applyOverlay("get_issued_blocks_in_section", { section: "S" }, [{ block: "B1", issued_count: 1 }, { block: "B2", issued_count: 1 }], it), [{ block: "B2", issued_count: 1 }]);
  const m = applyOverlay("get_home_metrics", {}, { pending_applications: 10, ready_to_record: 2, applied: 4, total_plans: 20, my_applications: 1, applications_today: 0, progress_pct: 20 }, it);
  assert.deepEqual([m.pending_applications, m.ready_to_record, m.applied, m.my_applications, m.applications_today, m.progress_pct], [9, 1, 5, 2, 1, 25]);
  // another section's screen is untouched
  assert.equal(applyOverlay("get_issued_blocks_in_section", { section: "OTHER" }, [{ block: "B1", issued_count: 1 }], it).length, 1);
});
test("with nothing waiting, data is returned as it is", () => {
  const d = [{ a: 1 }]; assert.equal(applyOverlay("get_home_metrics", {}, d, []), d);
});
test("waiting store requests show in the list, newest first, marked", () => {
  const rows = waitingStoreRequests([
    { method: "create_store_request", args: { block_fertilizer_plan: "P1" }, meta: { block: "B1", product_name: "CAN" } },
    { method: "create_store_request", args: { block_fertilizer_plan: "P2" }, meta: { block: "B2", product_name: "MOP" }, status: "failed" },
    { method: "mark_attendance", args: {} },
  ]);
  assert.equal(rows.length, 2); assert.equal(rows[0].block, "B2"); assert.equal(rows[0].status, "Not sent"); assert.equal(rows[1].status, "Waiting to send");
});

/* -------------------------------------------------------------------- seed */
test("the bootstrap becomes the same cache keys the screens ask for, with the programme folded in", () => {
  const fold = (a) => ({ ...(a || {}), programme: "FP1" });
  const plans = [{ name: "P1", block: "B1", status: "Issued" }, { name: "P2", block: "B1", status: "Planned" }, { name: "P3", block: "B2", status: "Planned" }];
  const seeds = seedsFromBootstrap({
    home: { a: 1 }, plans_by_section: { S1: plans }, issued_blocks_by_section: { S1: [{ block: "B1", issued_count: 1 }] },
    blocks_by_section: { S1: [{ name: "B1" }] }, applicators_by_block: { B1: [{ name: "E1" }] },
    issued_request_by_plan: { P1: "MR-1" }, store_requests: [],
  }, fold);
  const find = (m, a) => seeds.find((s) => s.method === m && stableStringify(s.args) === stableStringify(a));
  assert.deepEqual(find("get_home_metrics", { programme: "FP1" }).value, { a: 1 });
  assert.equal(find("get_pending_plans_for_section", { section: "S1", programme: "FP1" }).value.length, 3);
  assert.deepEqual(find("get_pending_plans_for_block", { block: "B1", programme: "FP1" }).value.map((p) => p.name), ["P1", "P2"], "block list derived from the section's plans");
  assert.equal(find("get_pending_plans_for_block", { block: "B2", programme: "FP1" }).value.length, 1);
  assert.equal(find("get_issued_request_for_plan", { block_fertilizer_plan: "P1", programme: "FP1" }).value, "MR-1");
  assert.deepEqual(find("get_applicators_for_block", { block: "B1", programme: "FP1" }).value, [{ name: "E1" }]);
  assert.deepEqual(find("get_store_requests", { programme: "FP1" }).value, [], "an empty list is saved too - 'nothing yet' is an answer");
});
test("parts the server left out are not seeded, so nothing is overwritten with nothing", () => {
  const seeds = seedsFromBootstrap({ home: null, upcoming: undefined, errors: { home: "x" } }, (a) => a || {});
  assert.equal(seeds.length, 0);
});

test("programmeLabel marks a micro-element programme so it is not mistaken for the main one", () => {
  const { programmeLabel } = require("../.test-build/programme");
  assert.equal(
    programmeLabel({ name: "FP-1", season: "2025/2026", farm: "Lokitela", crop: "Hass", period_type: "Custom Period",
      start_month: "August", end_month: "August", programme_type: "Micro", single_product: "BORAX" }),
    "Micro · BORAX · Aug");
  assert.equal(
    programmeLabel({ name: "FP-2", season: "2025/2026", farm: "Lokitela", crop: "Hass", period_type: "Full Year" }),
    "2025/2026 · Full year");
});

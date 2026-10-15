#!/usr/bin/env node
/** Offline checks for 0.1.2: attribution, schedule parks[], destination label, fast id miss, details, best time,
 * timeline math, plan-driven windows (/v1/me mocked: pro 400d, all-archive), park daily paging, budget headers,
 * key_status, and watch over a mock WebSocket (snapshot, update, condition, 4029 cap). The key never appears in output. */
import assert from "node:assert/strict";

const KEY = "offline-test-key-0000";
const WDW = "e957da41-3552-4cf6-b636-5babc5cbc4e5";
const MK = "75ea578a-adc8-4116-a54d-dccb60765ef9";
const SM = "b2260923-9315-40fd-9c6b-44dd811dbe64";
const json = (status, body, headers = {}) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
let me = { tier: "pro", historyDays: 400, historyAllArchive: false, historyEarliestDate: "2025-09-11", rateLimit: { unmetered: false, limit: 300, windowSeconds: 60, remaining: 290, reset: 30 }, historyRateLimit: { unmetered: false, limit: 6000, windowSeconds: 3600, remaining: 5990, reset: 100 } };
const seen = [];
globalThis.fetch = async (url, init) => {
  const u = String(url);
  seen.push({ url: u, headers: init.headers });
  if (u.endsWith("/destinations")) return json(200, { destinations: [{ id: WDW, name: "Walt Disney World® Resort", slug: "waltdisneyworldresort", externalId: "wdw-ext", parks: [{ id: MK, name: "Magic Kingdom Park" }] }] });
  if (u.endsWith("/me")) return init.headers["x-api-key"] ? json(200, me) : json(401, { error: { type: "AUTH", message: "key required" } });
  if (u.includes(`/entity/${WDW}/schedule/`)) return json(200, { id: WDW, schedule: [], parks: [{ id: MK, name: "Magic Kingdom Park", schedule: [{ date: "2026-10-15", type: "OPERATING", openingTime: "2026-10-15T09:00:00-04:00", closingTime: "2026-10-15T22:00:00-04:00" }] }] });
  if (u.includes(`/entity/${MK}/children`)) return json(200, { children: [{ id: SM, name: "Space Mountain", entityType: "ATTRACTION", parentId: MK }] });
  if (u.includes("/history/daily")) {
    const page2 = u.includes("page=2");
    return json(200, { id: MK, entityType: "PARK", timezone: "America/New_York", range: { from: "2025-10-01", to: "2026-10-15" }, entities: [{ id: SM, name: "Space Mountain", entityType: "ATTRACTION", days: [{ date: page2 ? "2026-10-02" : "2026-10-01", operatingMinutes: 600, downMinutes: page2 ? 60 : 0 }] }], next: page2 ? null : "https://api.themeparks.wiki/v1/entity/" + MK + "/history/daily?from=2026-10-02&to=2026-10-15&page=2" }, { "RateLimit-History-Limit": "6000", "RateLimit-History-Remaining": "5988", "RateLimit-History-Reset": "99", "RateLimit-History-Policy": "6000;w=3600" });
  }
  if (u.includes(`/entity/${MK}/history?`)) {
    return json(200, { id: MK, entityType: "PARK", timezone: "America/New_York", range: {}, entities: [{ id: SM, name: "Space Mountain", entityType: "ATTRACTION", opening: { time: "2026-10-11T04:00:00Z", observedAt: "2026-10-11T03:00:00Z", status: "CLOSED" }, history: [{ time: "2026-10-11T13:00:00Z", status: "OPERATING" }, { time: "2026-10-11T20:33:36Z", status: "DOWN" }, { time: "2026-10-11T21:00:00Z", status: "OPERATING" }] }], next: null });
  }
  if (u.includes(`/entity/${MK}`)) return json(200, { id: MK, name: "Magic Kingdom Park", entityType: "PARK", parentId: WDW, destinationId: WDW, timezone: "America/New_York" });
  if (u.includes(`/entity/${SM}/live`)) return json(200, { timezone: "America/New_York", liveData: [] });
  if (u.includes(`/entity/${SM}`)) return json(200, { id: SM, name: "Space Mountain", entityType: "ATTRACTION", parkId: MK, parentId: MK, destinationId: WDW, timezone: "America/New_York", attractionType: "RIDE", minimumHeight: 112, mayGetWet: false, location: { latitude: 1, longitude: 2 }, unsuitableForPregnantPeople: true });
  if (u.includes(`/entity/${WDW}`)) return json(200, { id: WDW, name: "Walt Disney World® Resort", entityType: "DESTINATION", timezone: "America/New_York" });
  return json(404, { error: { type: "Not found", message: "nope" } });
};

delete process.env.THEMEPARKS_API_KEY;
const m = await import("../server.mjs");
const run = (n, a) => m.callTool(n, a);
const pass = (s) => console.log("PASS " + s);

let r = await run("themeparks_schedule", { entity: WDW, from: "2026-10-15", days: 1 });
assert.equal(r.payload.days[0].entries[0].park, "Magic Kingdom Park");
assert.ok(r.payload.attribution.markdown.includes("Powered by ThemeParks.wiki"));
pass("destination schedule reads parks[] and labels each entry; attribution present");

r = await run("themeparks_find", { query: "Space Mountain", within: "Magic Kingdom" });
r = await run("themeparks_live", { entity: "Space Mountain", within: MK });
assert.equal(r.payload.entity.destination, "Walt Disney World® Resort");
assert.equal(r.payload.entity.park, "Magic Kingdom Park");
assert.equal(r.payload.entity.details.minimumHeight, 112);
assert.equal(r.payload.entity.details.heightUnit, "cm");
assert.equal(r.payload.entity.details.mayGetWet, false);
assert.equal(r.payload.entity.details.unsuitableForPregnantPeople, true);
pass("destination label correct with within=park; ride details incl. extra tags");

let before = seen.length;
r = await run("themeparks_live", { entity: "wdw-ext", limit: 1 });
assert.equal(r.payload.entity.id, WDW);
r = await run("themeparks_live", { entity: "123456;entityType=Attraction" });
assert.equal(r.payload.error, "not_found");
assert.equal(seen.slice(before).filter((s) => s.url.endsWith("/children")).length, 0);
pass("externalId resolves via catalog; unknown operator id fails with zero children scans");

r = await run("themeparks_uptime", { entity: "Space Mountain", granularity: "changes", date: "2026-10-11" });
assert.equal(r.isError, true);
const now = Date.parse("2026-10-15T14:10:00Z");
const fc = ["08", "09", "10", "11", "12", "13", "14", "15", "16"].map((h, i) => ({ time: `2026-10-15T${h}:00:00-04:00`, waitTime: [30, 40, 50, 45, 20, 20, 35, 60, 70][i], percentage: [25, 33, 40, 37, 16, 16, 29, 50, 58][i] }));
const b = m.bestTimeToRide(fc, "America/New_York", now);
assert.deepEqual([b.start, b.end, b.predictedWait, b.percentage], ["2026-10-15T12:00:00-04:00", "2026-10-15T14:00:00-04:00", 20, 16]);
assert.equal(m.bestTimeToRide([], "America/New_York", now).available, false);
pass("bestTimeToRide picks longest lowest window from now on (12-2 PM, 20m, 16%); empty -> unavailable with reason");

assert.equal(m.localToInstant("2026-10-11T16:00", "America/New_York").iso, "2026-10-11T16:00:00-04:00");
assert.equal(m.localToInstant("2026-12-11T16:00", "America/New_York").iso, "2026-12-11T16:00:00-05:00");
assert.equal(m.localToInstant("2026-10-11T16:00", "Asia/Tokyo").iso, "2026-10-11T16:00:00+09:00");
pass("park-local wall time -> instant across DST and zones");

const t = m.timeline({ time: "2026-10-11T20:00:00Z", status: "OPERATING", queue: { STANDBY: { waitTime: 50 } } }, [
  { time: "2026-10-11T20:33:36Z", status: "DOWN", queue: { STANDBY: { waitTime: null } } },
  { time: "2026-10-11T21:30:00Z", status: "OPERATING", queue: { STANDBY: { waitTime: 30 } } },
], Date.parse("2026-10-11T20:00:00Z"), Date.parse("2026-10-11T22:00:00Z"), "America/New_York");
assert.deepEqual(t.intervals.map((i) => [i.status, i.startLocal, i.minutes]), [["OPERATING", "Oct 11, 4:00:00 PM EDT", 34], ["DOWN", "Oct 11, 4:33:36 PM EDT", 56], ["OPERATING", "Oct 11, 5:30:00 PM EDT", 30]]);
assert.equal(t.waitTimeline.timeWeightedMean, 41); // (50m x 33.6min + 30m x 30min) / 63.6min; DOWN minutes excluded
pass("timeline: DOWN/OPERATING spans in park time, time-weighted mean wait");

r = await run("themeparks_find", { mode: "key_status" });
assert.equal(r.payload.keyConfigured, false);
assert.equal(r.payload.getAKey.signup, "https://www.themeparks.wiki/register");
r = await run("themeparks_uptime", { entity: MK, days: 30 });
assert.ok(!r.isError, JSON.stringify(r.payload));
const keylessDaily = seen.filter((s) => s.url.includes("/history/daily") && !s.url.includes("page=2")).at(-1).url;
assert.match(keylessDaily, /from=\d{4}-\d{2}-\d{2}&to=/);
const fromK = keylessDaily.match(/from=([\d-]+)/)[1], toK = keylessDaily.match(/to=([\d-]+)/)[1];
assert.equal((Date.parse(toK) - Date.parse(fromK)) / 86_400_000, 6);
pass("keyless: key_status points at signup; days clamps to the 7-day window");

process.env.THEMEPARKS_API_KEY = KEY;
r = await run("themeparks_find", { mode: "key_status" });
assert.equal(r.payload.valid, true);
assert.equal(r.payload.plan.tier, "pro");
assert.equal(r.payload.plan.historyRateLimit.remaining, 5990);
assert.ok(!JSON.stringify(r.payload).includes(KEY));
pass("key_status with key: /v1/me plan, window, budgets; key not echoed");

r = await run("themeparks_uptime", { entity: MK, days: 400 });
assert.ok(!r.isError, JSON.stringify(r.payload));
assert.equal(r.payload.pages, 2);
assert.equal(r.payload.entities[0].daysWithData, 2);
assert.equal(r.payload.entities[0].downMinutes, 60);
assert.deepEqual(r.payload.historyBudget, { limit: 6000, remaining: 5988, resetSeconds: 99, policy: "6000;w=3600" });
const keyedDaily = seen.filter((s) => s.url.includes("/history/daily") && !s.url.includes("page=2")).at(-1).url;
const fromP = keyedDaily.match(/from=([\d-]+)/)[1], toP = keyedDaily.match(/to=([\d-]+)/)[1];
assert.equal((Date.parse(toP) - Date.parse(fromP)) / 86_400_000, 399);
pass("pro plan (mocked): 400-day window honored, park daily next page followed, RateLimit-History budget reported");

me = { ...me, tier: "enterprise", historyDays: null, historyAllArchive: true, historyEarliestDate: null };
await run("themeparks_find", { mode: "key_status" });
r = await run("themeparks_uptime", { entity: MK, from: "2021-07-03", to: "2026-10-15" });
assert.ok(!r.isError, JSON.stringify(r.payload));
assert.equal(r.payload.access.historyDays, "all");
r = await run("themeparks_uptime", { entity: MK, from: "2010-01-01", to: "2026-10-15" });
assert.equal(r.payload.error, "bad_request");
pass("all-archive plan (mocked): 5-year daily range allowed; >3,660 days rejected");

r = await run("themeparks_uptime", { entity: MK, granularity: "changes", date: "2023-01-05" });
assert.ok(!r.isError, JSON.stringify(r.payload).slice(0, 300));
pass("all-archive plan: minute-level history years back is not blocked client-side");

for (const p of [r.payload]) assert.ok(!JSON.stringify(p).includes(KEY));
assert.ok(seen.filter((s) => s.headers["x-api-key"]).every((s) => s.url.startsWith("https://api.themeparks.wiki/")));
pass("key only ever sent to api.themeparks.wiki");

// --- watch over a mock WebSocket ---
class MockWS {
  static script = "ok";
  static last = null;
  constructor(url, protocols) {
    this.url = url; this.protocols = protocols; this.sent = []; MockWS.last = this;
    setTimeout(() => (MockWS.script === "cap" ? this.onclose?.({ code: 4029 }) : this.onopen?.()), 5);
  }
  emit(f) { this.onmessage?.({ data: JSON.stringify(f) }); }
  send(s) {
    const f = JSON.parse(s); this.sent.push(f);
    if (f.type === "auth") setTimeout(() => this.emit({ type: "welcome", data: { protocol: "preview", heartbeatIntervalMs: 30000, limits: { maxConnections: 1, maxSubscriptions: 1, firehose: false } } }), 5);
    if (f.type === "subscribe") {
      setTimeout(() => this.emit({ type: "subscribed", channel: f.channel, data: { subscriptionId: "sub-1", name: "Space Mountain", entityType: "ATTRACTION" } }), 5);
      setTimeout(() => this.emit({ type: "snapshot", final: true, data: [{ id: SM, name: "Space Mountain", entityType: "ATTRACTION", status: "DOWN", queue: { STANDBY: { waitTime: null } }, lastUpdated: new Date().toISOString() }] }), 10);
      setTimeout(() => this.emit({ type: "update", ts: Date.now(), data: { id: SM, name: "Space Mountain", entityType: "ATTRACTION", status: "OPERATING", queue: { STANDBY: { waitTime: 25 } }, lastUpdated: new Date().toISOString() } }), 30);
    }
  }
  close() { this.closed = true; }
}
m.setWebSocketImpl(MockWS);
r = await run("themeparks_live", { entity: SM, mode: "watch", until_status: "OPERATING", watch_seconds: 10 });
assert.ok(!r.isError, JSON.stringify(r.payload));
assert.equal(r.payload.stopReason, "condition_met");
assert.equal(r.payload.triggeredBy.previousStatus, "DOWN");
assert.equal(r.payload.snapshot.status, "DOWN");
assert.deepEqual(MockWS.last.protocols, ["preview"]);
assert.equal(MockWS.last.sent[0].type, "auth");
assert.equal(MockWS.last.sent[1].snapshot, true);
assert.ok(MockWS.last.closed);
assert.ok(!JSON.stringify(r.payload).includes(KEY));
pass("watch: auth frame, snapshot, DOWN->OPERATING update stops early, socket closed, key not echoed");

MockWS.script = "cap";
r = await run("themeparks_live", { entity: SM, mode: "watch", watch_seconds: 5 });
assert.equal(r.payload.error, "watch_failed");
assert.match(r.payload.message, /Connection cap/);
pass("watch: close 4029 -> clear connection-cap error");

m.setWebSocketImpl(undefined);
r = await run("themeparks_live", { entity: SM, mode: "watch" });
assert.equal(r.payload.error, "unsupported_runtime");
delete process.env.THEMEPARKS_API_KEY;
r = await run("themeparks_live", { entity: SM, mode: "watch" });
assert.equal(r.payload.error, "key_required");
pass("watch: no WebSocket runtime -> unsupported_runtime; no key -> key_required");

console.log("offline-keyed-test: PASS");

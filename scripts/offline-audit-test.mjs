#!/usr/bin/env node
/** Offline coverage for the 0.1.4 audit fixes. The API key in this file is fake and must never be printed. */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const KEY = "audit-offline-key-0000";
const WDW = "e957da41-3552-4cf6-b636-5babc5cbc4e5";
const MK = "75ea578a-adc8-4116-a54d-dccb60765ef9";
const RIDE = "b2260923-9315-40fd-9c6b-44dd811dbe64";
const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const pass = (s) => console.log("PASS " + s);
const json = (status, body, headers = {}) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
const park = (id, name = "Magic Kingdom Park") => ({ id, name, entityType: "PARK", timezone: "America/New_York", parentId: WDW, destinationId: WDW });
const destinations = () => json(200, { destinations: [{ id: WDW, name: "Walt Disney World Resort", slug: "waltdisneyworldresort", parks: [{ id: MK, name: "Magic Kingdom Park" }] }] });

delete process.env.THEMEPARKS_API_KEY;
let fetchImpl = async () => json(404, { error: { message: "unset" } });
globalThis.fetch = (url, init) => fetchImpl(url, init);
const m = await import("../server.mjs");
const run = (name, args) => m.callTool(name, args);

// --- non-429 search failure ---
{
  fetchImpl = async (url) => {
    const u = String(url);
    if (u.endsWith("/destinations")) {
      return json(200, { destinations: [
        { id: WDW, name: "Walt Disney World Resort", parks: [] },
        { id: "small", name: "Smallville Gardens", parks: [] },
      ] });
    }
    if (u.includes("/children")) return json(500, { message: "backend down" });
    return json(404, { error: { message: "no" } });
  };
  const r = await run("themeparks_find", { query: "Space Mountain" });
  assert.equal(r.isError, true, JSON.stringify(r.payload));
  assert.equal(r.payload.error, "upstream_error");
  assert.notEqual(r.payload.error, "not_found");
  assert.equal(r.payload.scan?.destinationsScanned, 0);
  assert.equal(r.payload.scan?.stoppedBy, "upstream_error");
  assert.ok(r.payload.attribution.markdown.includes("Powered by ThemeParks.wiki"));
  pass("non-429 search failure is upstream_error, not not_found");
}

// --- concurrent stdio: second call waits, frames stay intact ---
{
  let inFlight = 0;
  let maxInFlight = 0;
  fetchImpl = async (url) => {
    inFlight++;
    maxInFlight = Math.max(maxInFlight, inFlight);
    await new Promise((r) => setTimeout(r, 20));
    inFlight--;
    const u = String(url);
    if (u.endsWith("/destinations")) return destinations();
    if (u.includes(`/entity/${A}`)) return json(200, park(A, "Park A"));
    if (u.includes(`/entity/${B}`)) return json(200, park(B, "Park B"));
    if (u.endsWith("/live")) return json(200, { timezone: "America/New_York", liveData: [] });
    return json(404, { error: { message: "no" } });
  };
  const writes = [];
  m._setStdoutSink((buf) => { writes.push(buf); return true; });
  const frame = (id, entity) => JSON.stringify({ jsonrpc: "2.0", id, method: "tools/call", params: { name: "themeparks_live", arguments: { entity, limit: 1 } } });
  const p1 = m._dispatchIncoming(frame(1, A));
  const p2 = m._dispatchIncoming(frame(2, B));
  await Promise.all([p1, p2]);
  // One live call fetches sequentially, and destinations are already cached.
  // Two calls in flight together would overlap their entity reads (max >= 2).
  assert.equal(maxInFlight, 1, `fetches overlapped across calls (${maxInFlight})`);
  const buf = Buffer.concat(writes);
  const msgs = [];
  let rest = buf;
  while (rest.length) {
    const sep = rest.indexOf("\r\n\r\n");
    assert.notEqual(sep, -1, "truncated frame");
    const len = Number(rest.subarray(0, sep).toString().match(/Content-Length:\s*(\d+)/i)[1]);
    assert.equal(rest.length >= sep + 4 + len, true);
    msgs.push(JSON.parse(rest.subarray(sep + 4, sep + 4 + len).toString()));
    rest = rest.subarray(sep + 4 + len);
  }
  assert.deepEqual(msgs.map((msg) => msg.id), [1, 2]);
  m._setStdoutSink((buf) => process.stdout.write(buf));
  pass("concurrent stdio calls stay serial and each frame parses");
}

{
  const child = spawn(process.execPath, ["./server.mjs"], { cwd: root, stdio: ["pipe", "pipe", "inherit"] });
  const body = (id) => {
    const payload = Buffer.from(JSON.stringify({ jsonrpc: "2.0", id, method: "tools/list" }));
    return Buffer.concat([Buffer.from(`Content-Length: ${payload.length}\r\n\r\n`), payload]);
  };
  child.stdin.write(Buffer.concat([body(11), body(12)]));
  const chunks = [];
  const got = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("stdio child timed out")), 5000);
    child.stdout.on("data", (c) => {
      chunks.push(c);
      const buf = Buffer.concat(chunks);
      const msgs = [];
      let rest = buf;
      for (;;) {
        const sep = rest.indexOf("\r\n\r\n");
        if (sep === -1) return;
        const len = Number(rest.subarray(0, sep).toString().match(/Content-Length:\s*(\d+)/i)?.[1]);
        if (!Number.isFinite(len) || rest.length < sep + 4 + len) return;
        msgs.push(JSON.parse(rest.subarray(sep + 4, sep + 4 + len).toString()));
        rest = rest.subarray(sep + 4 + len);
        if (msgs.length === 2) {
          clearTimeout(timer);
          resolve(msgs);
        }
      }
    });
    child.on("exit", (code) => reject(new Error(`child exited ${code}`)));
  });
  child.kill();
  assert.deepEqual(got.map((msg) => msg.id), [11, 12]);
  assert.equal(got[0].result.tools.length, 4);
  pass("subprocess accepts two pipelined tools/list frames");
}

// --- cache grace: 502 inside the window is stale; past it errors ---
{
  const realNow = Date.now;
  let skew = 0;
  Date.now = () => realNow() + skew;
  const LIVE = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
  let liveStatus = 200;
  fetchImpl = async (url) => {
    const u = String(url);
    if (u.endsWith("/destinations")) return destinations();
    if (u.includes(`/entity/${LIVE}`) && !u.endsWith("/live")) return json(200, park(LIVE));
    if (u.endsWith("/live")) return liveStatus === 200 ? json(200, { timezone: "America/New_York", liveData: [{ id: LIVE, name: "Park", entityType: "PARK", status: "OPERATING", lastUpdated: new Date(realNow()).toISOString() }] }) : json(502, { message: "bad gateway" });
    return json(404, { error: { message: "no" } });
  };
  let r = await run("themeparks_live", { entity: LIVE, limit: 1 });
  assert.equal(r.isError, false, JSON.stringify(r.payload));
  liveStatus = 502;
  skew = 2 * 60_000;
  r = await run("themeparks_live", { entity: LIVE, limit: 1 });
  assert.equal(r.isError, false, JSON.stringify(r.payload));
  assert.equal(r.payload.cached, true);
  assert.equal(r.payload.staleBecause, "upstream_error");
  skew = 10 * 60_000;
  r = await run("themeparks_live", { entity: LIVE, limit: 1 });
  assert.equal(r.isError, true, JSON.stringify(r.payload));
  assert.equal(r.payload.error, "upstream_error");
  Date.now = realNow;
  pass("502 inside the live grace serves stale; past the grace it errors");
}

// --- redirects never carry the key off-host ---
{
  process.env.THEMEPARKS_API_KEY = KEY;
  const REDIR = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
  const seen = [];
  fetchImpl = async (url, init) => {
    const u = String(url);
    seen.push({ url: u, redirect: init?.redirect, key: init?.headers?.["x-api-key"] ?? null });
    if (u.includes("evil.example")) return json(200, { leaked: true });
    if (u.endsWith("/destinations")) return destinations();
    if (u.includes(`/entity/${REDIR}`) && !u.includes("canon=1")) {
      return new Response("", { status: 302, headers: { location: "https://evil.example/steal" } });
    }
    return json(404, { error: { message: "no" } });
  };
  let r = await run("themeparks_live", { entity: REDIR, limit: 1 });
  assert.equal(r.payload.error, "upstream_error");
  assert.match(r.payload.message, /off api\.themeparks\.wiki/);
  assert.equal(seen.some((s) => s.url.includes("evil.example")), false);
  assert.ok(seen.every((s) => s.redirect === "manual"));
  assert.ok(seen.filter((s) => s.key).every((s) => s.url.startsWith("https://api.themeparks.wiki/")));
  assert.equal(JSON.stringify(r.payload).includes(KEY), false);

  const SAME = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
  seen.length = 0;
  fetchImpl = async (url, init) => {
    const u = String(url);
    seen.push({ url: u, redirect: init?.redirect, key: init?.headers?.["x-api-key"] ?? null });
    if (u.endsWith("/destinations")) return destinations();
    if (u.includes(`/entity/${SAME}`) && !u.includes("canon=1") && !u.endsWith("/live")) {
      return new Response("", { status: 302, headers: { location: `https://api.themeparks.wiki/v1/entity/${SAME}?canon=1` } });
    }
    if (u.includes("canon=1")) return json(200, park(SAME));
    if (u.endsWith("/live")) return json(200, { timezone: "America/New_York", liveData: [] });
    return json(404, { error: { message: "no" } });
  };
  r = await run("themeparks_live", { entity: SAME, limit: 1 });
  assert.equal(r.isError, false, JSON.stringify(r.payload));
  assert.ok(seen.some((s) => s.url.includes("canon=1") && s.key === KEY));
  assert.equal(seen.some((s) => !s.url.startsWith("https://api.themeparks.wiki/")), false);
  assert.equal(JSON.stringify(r.payload).includes(KEY), false);

  process.env.THEMEPARKS_API_KEY = "bad\r\nkey";
  const FRESH = "ffffffff-ffff-4fff-8fff-ffffffffffff";
  r = await run("themeparks_live", { entity: FRESH, limit: 1 });
  assert.equal(r.payload.error, "bad_request");
  const dumped = JSON.stringify(r.payload);
  assert.equal(dumped.includes("bad\\r\\nkey"), false);
  assert.equal(dumped.includes("bad\r"), false);
  delete process.env.THEMEPARKS_API_KEY;
  pass("redirects stay on api.themeparks.wiki; a header-breaking key is refused and not echoed");
}

// --- invalid dates and times ---
{
  fetchImpl = async (url) => {
    const u = String(url);
    if (u.endsWith("/destinations")) return destinations();
    if (u.includes(`/entity/${MK}`) && !u.includes("/schedule") && !u.includes("/live") && !u.includes("/history")) return json(200, park(MK));
    return json(200, { schedule: [] });
  };
  let r = await run("themeparks_schedule", { entity: MK, from: "2026-02-31", days: 1 });
  assert.equal(r.payload.error, "bad_request");
  assert.match(r.payload.message, /real calendar date/);
  r = await run("themeparks_uptime", { entity: MK, granularity: "changes", from: "2026-10-11T99:99" });
  assert.equal(r.payload.error, "bad_request");
  assert.match(r.payload.message, /clock time/);
  r = await run("themeparks_uptime", { entity: MK, granularity: "changes", from: "2026-13-01T00:00:00Z", to: "2026-13-01T01:00:00Z" });
  assert.equal(r.payload.error, "bad_request");
  assert.match(r.payload.message, /real timestamp/);
  pass("impossible dates and times are bad_request");
}

// --- DST gap rejected; overlap kept and labeled ---
{
  let threw = false;
  try {
    m.localToInstant("2026-03-08T02:30", "America/New_York");
  } catch (err) {
    threw = true;
    assert.equal(err.code, "bad_request");
    assert.match(err.message, /does not exist/);
  }
  assert.equal(threw, true);
  const ov = m.localToInstant("2026-11-01T01:30", "America/New_York");
  assert.equal(ov.iso, "2026-11-01T01:30:00-04:00");
  assert.match(ov.ambiguousNote, /twice/);
  assert.match(ov.ambiguousNote, /-04:00/);
  const now = Date.parse("2026-10-15T05:10:00Z");
  const fc = ["09", "10", "11", "12"].map((h, i) => ({ time: `2026-10-15T${h}:00:00+05:30`, waitTime: [50, 10, 40, 30][i], percentage: i }));
  const best = m.bestTimeToRide(fc, "Asia/Kolkata", now);
  assert.equal(best.predictedWait, 10);
  assert.match(best.start, /T10:00:00\+05:30/);
  pass("DST gap rejected, overlap labeled, forecast hour uses the park zone");
}

// --- watch clamp, chunked snapshot, retryable error ---
{
  process.env.THEMEPARKS_API_KEY = KEY;
  fetchImpl = async (url) => {
    const u = String(url);
    if (u.endsWith("/destinations")) return destinations();
    if (u.includes(`/entity/${MK}`)) return json(200, park(MK));
    if (u.includes(`/entity/${RIDE}`)) return json(200, { id: RIDE, name: "Space Mountain", entityType: "ATTRACTION", parkId: MK, parentId: MK, destinationId: WDW, timezone: "America/New_York" });
    return json(404, { error: { message: "no" } });
  };
  const realSetTimeout = globalThis.setTimeout;
  const delays = [];
  globalThis.setTimeout = (fn, ms, ...args) => {
    delays.push(ms);
    return realSetTimeout(fn, ms, ...args);
  };
  class ClampWS {
    constructor() { this.sent = []; realSetTimeout(() => this.onopen?.(), 1); }
    send(s) {
      const f = JSON.parse(s);
      this.sent.push(f);
      if (f.type === "auth") realSetTimeout(() => this.onmessage?.({ data: JSON.stringify({ type: "welcome", data: { protocol: "preview", limits: { maxConnections: 1 } } }) }), 1);
      if (f.type === "subscribe") realSetTimeout(() => this.onmessage?.({ data: JSON.stringify({ type: "snapshot", final: true, data: [{ id: RIDE, name: "Space Mountain", entityType: "ATTRACTION", status: "OPERATING" }] }) }), 1);
    }
    close() {}
  }
  m.setWebSocketImpl(ClampWS);
  let r = await run("themeparks_live", { entity: RIDE, mode: "watch", watch_seconds: 9999, snapshot_only: true });
  assert.equal(r.isError, false, JSON.stringify(r.payload));
  assert.equal(r.payload.stopReason, "snapshot_only");
  assert.ok(delays.includes(120_000), JSON.stringify(delays));
  assert.equal(JSON.stringify(r.payload).includes(KEY), false);
  globalThis.setTimeout = realSetTimeout;
  pass("watch_seconds above 120 is clamped to a 120s timer");

  class ChunkWS {
    constructor() { realSetTimeout(() => this.onopen?.(), 1); }
    send(s) {
      const f = JSON.parse(s);
      if (f.type === "auth") realSetTimeout(() => this.onmessage?.({ data: JSON.stringify({ type: "welcome", data: { protocol: "preview" } }) }), 1);
      if (f.type === "subscribe") {
        realSetTimeout(() => this.onmessage?.({ data: JSON.stringify({ type: "snapshot", data: [{ id: RIDE, name: "Space Mountain", entityType: "ATTRACTION", status: "DOWN" }] }) }), 1);
        realSetTimeout(() => this.onmessage?.({ data: JSON.stringify({ type: "snapshot", final: true, data: [{ id: A, name: "Other", entityType: "ATTRACTION", status: "OPERATING" }] }) }), 8);
      }
    }
    close() {}
  }
  m.setWebSocketImpl(ChunkWS);
  r = await run("themeparks_live", { entity: MK, mode: "watch", snapshot_only: true, watch_seconds: 30 });
  assert.equal(r.isError, false, JSON.stringify(r.payload));
  assert.equal(r.payload.stopReason, "snapshot_only");
  assert.equal(r.payload.snapshotPartial, undefined);
  assert.equal(r.payload.snapshot.entities, 2);
  pass("chunked snapshot waits for final:true");

  globalThis.setTimeout = (fn, ms, ...args) => realSetTimeout(fn, ms >= 1000 ? 15 : ms, ...args);
  class PartialWS {
    constructor() { realSetTimeout(() => this.onopen?.(), 1); }
    send(s) {
      const f = JSON.parse(s);
      if (f.type === "auth") realSetTimeout(() => this.onmessage?.({ data: JSON.stringify({ type: "welcome", data: {} }) }), 1);
      if (f.type === "subscribe") realSetTimeout(() => this.onmessage?.({ data: JSON.stringify({ type: "snapshot", data: [{ id: RIDE, name: "Space Mountain", entityType: "ATTRACTION", status: "DOWN" }] }) }), 1);
    }
    close() {}
  }
  m.setWebSocketImpl(PartialWS);
  r = await run("themeparks_live", { entity: MK, mode: "watch", watch_seconds: 5 });
  assert.equal(r.isError, false, JSON.stringify(r.payload));
  assert.equal(r.payload.stopReason, "time_limit");
  assert.equal(r.payload.snapshotPartial, true);
  globalThis.setTimeout = realSetTimeout;
  pass("snapshot without final:true stays partial when the timer wins");

  let subs = 0;
  class RetryWS {
    constructor() { realSetTimeout(() => this.onopen?.(), 1); }
    send(s) {
      const f = JSON.parse(s);
      if (f.type === "auth") realSetTimeout(() => this.onmessage?.({ data: JSON.stringify({ type: "welcome", data: { protocol: "preview" } }) }), 1);
      if (f.type === "subscribe") {
        subs++;
        const message = subs === 1 ? "busy" : "still busy";
        realSetTimeout(() => this.onmessage?.({ data: JSON.stringify({ type: "error", data: { code: 4290, message, retryable: true } }) }), 1);
      }
    }
    close() {}
  }
  m.setWebSocketImpl(RetryWS);
  const t0 = Date.now();
  r = await run("themeparks_live", { entity: RIDE, mode: "watch", watch_seconds: 30 });
  assert.equal(r.payload.error, "watch_failed");
  assert.match(r.payload.message, /still busy/);
  assert.equal(subs, 2);
  assert.ok(Date.now() - t0 < 5000, `retry took ${Date.now() - t0}ms`);
  assert.equal(JSON.stringify(r.payload).includes(KEY), false);
  pass("retryable WebSocket error resubscribes once, then watch_failed");
}

// --- park daily page cap, clamp note, hyphenated fallthrough, retryAfter ---
{
  let me = { tier: "free", historyDays: 30, historyAllArchive: false, historyEarliestDate: "2026-09-15", rateLimit: { unmetered: false, limit: 300, windowSeconds: 60 }, historyRateLimit: { unmetered: false, limit: 600, windowSeconds: 3600 } };
  let liveHits = 0;
  fetchImpl = async (url, init) => {
    const u = String(url);
    if (init?.headers?.["x-api-key"] === KEY && u.endsWith("/me")) return json(200, me);
    if (u.endsWith("/destinations")) return destinations();
    if (u.includes(`/entity/${WDW}/children`) || u.includes(`/entity/${MK}/children`)) {
      return json(200, { children: [{ id: RIDE, name: "Seven Dwarfs Mine Train", entityType: "ATTRACTION", parentId: MK }] });
    }
    if (u.includes("/children")) return json(200, { children: [] });
    if (u.includes("/history/daily")) return json(200, { id: RIDE, entityType: "ATTRACTION", timezone: "America/New_York", range: { from: "2026-09-16", to: "2026-10-15" }, days: [], next: null });
    if (u.includes(`/entity/${MK}`) && !u.includes("/history") && !u.includes("/live")) return json(200, park(MK));
    if (u.includes(`/entity/${RIDE}`) && !u.includes("/history") && !u.includes("/live")) return json(200, { id: RIDE, name: "Seven Dwarfs Mine Train", entityType: "ATTRACTION", parkId: MK, parentId: MK, destinationId: WDW, timezone: "America/New_York" });
    if (u.endsWith("/live")) {
      liveHits++;
      if (liveHits === 1) return json(429, { retryAfter: 17 }, { "retry-after": "17" });
      if (liveHits === 2) return json(429, { error: { type: "HISTORY_RATE_LIMITED", message: "hourly budget", retryAfter: 9 } });
      const when = new Date(Date.now() + 120_000).toUTCString();
      return json(429, { message: "slow" }, { "retry-after": when });
    }
    if (u.includes("seven-dwarfs-mine-train")) return json(404, { error: { message: "not a slug" } });
    if (u.includes("123") && u.includes("foo")) return json(404, { error: { message: "not an id" } });
    return json(404, { error: { message: "no" } });
  };
  process.env.THEMEPARKS_API_KEY = KEY;
  await run("themeparks_find", { mode: "key_status" });
  let r = await run("themeparks_uptime", { entity: MK, from: "2024-01-01", to: "2026-10-15" });
  assert.equal(r.payload.error, "bad_request");
  assert.match(r.payload.message, /15 pages/);
  assert.equal(r.payload.historyCalls, 15);
  assert.equal(r.payload.maxDays, 465);
  pass("park daily range over 15 pages is rejected up front");

  r = await run("themeparks_uptime", { entity: RIDE, days: 45 });
  assert.equal(r.isError, false, JSON.stringify(r.payload));
  assert.match(r.payload.note, /Requested 45 days/);
  assert.match(r.payload.note, /allows 30/);
  assert.equal(JSON.stringify(r.payload).includes(KEY), false);
  pass("days=45 on a 30-day plan is clamped with a note");

  delete process.env.THEMEPARKS_API_KEY;
  const beforeChildren = { n: 0 };
  const prev = fetchImpl;
  fetchImpl = async (url, init) => {
    if (String(url).includes("/children")) beforeChildren.n++;
    return prev(url, init);
  };
  r = await run("themeparks_find", { query: "seven-dwarfs-mine-train" });
  assert.equal(r.isError, false, JSON.stringify(r.payload));
  assert.equal(r.payload.matches[0].name, "Seven Dwarfs Mine Train");
  assert.ok(beforeChildren.n > 0);
  const childrenAt = beforeChildren.n;
  r = await run("themeparks_live", { entity: "123;foo=bar", limit: 1 });
  assert.equal(r.payload.error, "not_found");
  assert.equal(beforeChildren.n, childrenAt);
  pass("hyphenated name falls through to search; operator ids still fail fast");

  r = await run("themeparks_live", { entity: RIDE, limit: 1 });
  assert.equal(r.payload.retryAfterSeconds, 17);
  r = await run("themeparks_live", { entity: RIDE, limit: 1 });
  assert.equal(r.payload.retryAfterSeconds, 9);
  r = await run("themeparks_live", { entity: RIDE, limit: 1 });
  assert.ok(r.payload.retryAfterSeconds >= 115 && r.payload.retryAfterSeconds <= 125, String(r.payload.retryAfterSeconds));
  assert.equal(JSON.stringify(r.payload).includes(KEY), false);
  pass("retryAfter is read from the top-level field, error.retryAfter, and an HTTP-date header");
}

console.log("offline-audit-test: PASS");

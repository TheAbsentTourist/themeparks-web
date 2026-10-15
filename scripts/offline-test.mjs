#!/usr/bin/env node
/** Offline behavior checks with a stubbed fetch and clock: 429 handling, serve-stale on 429, scan stop on 429, optional x-api-key header. */
import assert from "node:assert/strict";

const SM = "b2260923-9315-40fd-9c6b-44dd811dbe64";
const entity = { id: SM, name: "Space Mountain", entityType: "ATTRACTION", timezone: "America/New_York" };
const live = { liveData: [{ id: SM, name: "Space Mountain", entityType: "ATTRACTION", status: "DOWN", queue: { STANDBY: { waitTime: null }, BOARDING_GROUP: { allocationStatus: "PAUSED", currentGroupStart: 10, currentGroupEnd: 20, nextAllocationTime: null, estimatedWait: 30 }, NEW_KIND: { x: 1 } }, lastUpdated: "2020-01-01T00:00:00Z" }] };
const json = (status, body, headers = {}) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

let mode = "ok";
let destinations = [];
const realNow = Date.now;
let skewMs = 0;
Date.now = () => realNow() + skewMs;
const seen = [];
globalThis.fetch = async (url, init) => {
  seen.push({ url: String(url), headers: init.headers });
  if (mode === "429") return json(429, { error: "Too Many Requests", message: "Too Many Requests", retryAfter: 17 }, { "retry-after": "17" });
  if (String(url).endsWith("/destinations")) return json(200, { destinations: destinations });
  if (String(url).endsWith("/children")) return mode === "children429" ? json(429, { retryAfter: 9 }) : json(200, { children: [] });
  if (String(url).endsWith("/live")) return json(200, live);
  return json(200, entity);
};

delete process.env.THEMEPARKS_API_KEY;
const { callTool } = await import("../server.mjs");
const run = async (name, args) => callTool(name, args);

mode = "429";
let r = await run("themeparks_live", { entity: SM });
assert.equal(r.isError, true);
assert.equal(r.payload.error, "rate_limited");
assert.equal(r.payload.retryAfterSeconds, 17);
console.log("PASS 429 without cache -> rate_limited retryAfterSeconds=17");

mode = "ok";
r = await run("themeparks_live", { entity: SM });
assert.equal(r.isError, false);
const item = r.payload.items[0];
assert.equal(item.status, "DOWN");
assert.equal(item.boardingGroup.state, "PAUSED");
assert.deepEqual(item.otherQueues, { NEW_KIND: { x: 1 } });
assert.equal(item.stale, true);
console.log("PASS live maps BOARDING_GROUP, passes unknown queue kinds through, flags stale lastUpdated");

assert.equal(seen.some((s) => "x-api-key" in s.headers), false);
console.log("PASS no x-api-key header when THEMEPARKS_API_KEY is unset");

process.env.THEMEPARKS_API_KEY = "test-key-not-real";
await new Promise((res) => setTimeout(res, 0));
const before = seen.length;
r = await run("themeparks_uptime", { entity: SM, days: 1 });
assert.equal(seen.slice(before).find((s) => s.url.includes("/history/daily")).headers["x-api-key"], "test-key-not-real");
console.log("PASS x-api-key sent when THEMEPARKS_API_KEY is set");

process.env.THEMEPARKS_API_KEY = "${THEMEPARKS_API_KEY}";
const before2 = seen.length;
await run("themeparks_uptime", { entity: SM, days: 2 });
assert.equal(seen.slice(before2).some((s) => "x-api-key" in s.headers), false);
console.log("PASS unexpanded ${THEMEPARKS_API_KEY} placeholder is not sent");

process.env.THEMEPARKS_API_KEY = "";
skewMs += 61_000;
mode = "429";
r = await run("themeparks_live", { entity: SM });
assert.equal(r.isError, false, JSON.stringify(r.payload));
assert.equal(r.payload.cached, true);
assert.equal(r.payload.staleBecause, "rate_limited");
assert.equal(r.payload.items[0].status, "DOWN");
console.log(`PASS 429 after TTL expiry serves stale cache (staleBecause=rate_limited, fetchedAt=${r.payload.fetchedAt})`);

skewMs += 301_000;
mode = "children429";
destinations = [{ id: "d1", name: "Walt Disney World Resort", slug: "wdw", parks: [] }, { id: "d2", name: "Small Park", slug: "sp", parks: [] }];
r = await run("themeparks_find", { query: "Nonexistent Ride" });
assert.equal(r.isError, false);
assert.equal(r.payload.scan.stoppedBy, "rate_limited");
assert.equal(r.payload.totalMatched, 0);
console.log("PASS all-resort search stops cleanly on 429 (scan.stoppedBy=rate_limited)");

console.log("offline-test: PASS");

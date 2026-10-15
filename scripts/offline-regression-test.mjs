#!/usr/bin/env node
/** 0.1.3 regressions, offline: name scoring tiers, PARK labels inside a resort, per-item timezone in same-name groups,
 * and the real NightFlight Expedition 2026-10-11 rows (fixture captured from /history, keyless and keyed identical). */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const fx = JSON.parse(readFileSync(new URL("./fixtures/nightflight-2026-10-11.json", import.meta.url), "utf8"));
const WDW = "e957da41-3552-4cf6-b636-5babc5cbc4e5", MK = "75ea578a-adc8-4116-a54d-dccb60765ef9", DLR = "bfc89fd6-314d-44b4-b89e-df1a89cf991e", DLP = "dae968d5-630d-4719-8b06-3d107e944401";
const DL_PARK = "7340550b-c14d-4def-80bb-acdb51d49a66", DLP_PARK = "dae968d5-park", SM_MK = "b2260923-9315-40fd-9c6b-44dd811dbe64", SM_DL = "9167db1d-e5e7-46da-a07f-ae30a87bc4c4";
const NF = fx.id, DOLLY = "6c3cd0cc-57b5-431b-926c-2658e8104057", DOLLY_PARK = "7502308a-de08-41a3-b997-961f8275ab3c";
const json = (b) => new Response(JSON.stringify(b), { status: 200, headers: { "content-type": "application/json" } });
const fc = (off) => ["08", "09", "10", "11", "12", "13", "14", "15", "16", "17", "18", "19", "20", "21", "22", "23"].map((h, i) => ({ time: `2099-01-01T${h}:00:00${off}`, waitTime: 30 + i, percentage: 20 }));
globalThis.fetch = async (url) => {
  const u = String(url);
  if (u.endsWith("/destinations")) return json({ destinations: [
    { id: WDW, name: "Walt Disney World® Resort", slug: "waltdisneyworldresort", parks: [{ id: MK, name: "Magic Kingdom Park" }] },
    { id: DLR, name: "Disneyland Resort", slug: "disneylandresort", parks: [{ id: DL_PARK, name: "Disneyland Park" }] },
    { id: DLP, name: "Disneyland Paris", slug: "disneylandparis", parks: [{ id: DLP_PARK, name: "Disneyland Park" }] },
    { id: DOLLY, name: "Dollywood", slug: "dollywood", parks: [{ id: DOLLY_PARK, name: "Dollywood" }] },
  ] });
  if (u.endsWith(`/entity/${WDW}/children`)) return json({ children: [{ id: MK, name: "Magic Kingdom Park", entityType: "PARK", parentId: WDW }, { id: SM_MK, name: "Space Mountain", entityType: "ATTRACTION", parentId: MK }] });
  if (u.endsWith(`/entity/${DLR}/children`)) return json({ children: [{ id: DL_PARK, name: "Disneyland Park", entityType: "PARK", parentId: DLR }, { id: SM_DL, name: "Space Mountain", entityType: "ATTRACTION", parentId: DL_PARK }] });
  if (u.endsWith("/children")) return json({ children: [] });
  if (u.endsWith(`/entity/${SM_MK}/live`)) return json({ timezone: "America/New_York", liveData: [{ id: SM_MK, name: "Space Mountain", entityType: "ATTRACTION", parkId: MK, status: "OPERATING", forecast: fc("-05:00") }] });
  if (u.endsWith(`/entity/${SM_DL}/live`)) return json({ timezone: "America/Los_Angeles", liveData: [{ id: SM_DL, name: "Space Mountain", entityType: "ATTRACTION", parkId: DL_PARK, status: "OPERATING", forecast: fc("-08:00") }] });
  if (u.includes(`/entity/${NF}/history?`)) {
    const q = new URL(u).searchParams;
    const from = Date.parse(q.get("from")), to = Date.parse(q.get("to"));
    const prior = fx.history.filter((r) => Date.parse(r.time) <= from).at(-1);
    return json({ ...fx, range: { from: q.get("from"), to: q.get("to") }, opening: { time: new Date(from).toISOString(), observedAt: prior.time, status: prior.status, queue: prior.queue }, history: fx.history.filter((r) => Date.parse(r.time) > from && Date.parse(r.time) < to) });
  }
  const id = u.split("/entity/")[1]?.split(/[/?]/)[0];
  const ents = {
    [WDW]: { id: WDW, name: "Walt Disney World® Resort", entityType: "DESTINATION", timezone: "America/New_York" },
    [DLR]: { id: DLR, name: "Disneyland Resort", entityType: "DESTINATION", timezone: "America/Los_Angeles" },
    [MK]: { id: MK, name: "Magic Kingdom Park", entityType: "PARK", parentId: WDW, destinationId: WDW, timezone: "America/New_York" },
    [DL_PARK]: { id: DL_PARK, name: "Disneyland Park", entityType: "PARK", parentId: DLR, destinationId: DLR, timezone: "America/Los_Angeles" },
    [SM_MK]: { id: SM_MK, name: "Space Mountain", entityType: "ATTRACTION", parkId: MK, parentId: MK, destinationId: WDW, timezone: "America/New_York" },
    [SM_DL]: { id: SM_DL, name: "Space Mountain", entityType: "ATTRACTION", parkId: DL_PARK, parentId: DL_PARK, destinationId: DLR, timezone: "America/Los_Angeles" },
    [NF]: { id: NF, name: "NightFlight Expedition", entityType: "ATTRACTION", parkId: DOLLY_PARK, parentId: DOLLY_PARK, destinationId: DOLLY, timezone: "America/New_York" },
  };
  return ents[id] ? json(ents[id]) : new Response(JSON.stringify({ error: { message: "nf" } }), { status: 404 });
};
delete process.env.THEMEPARKS_API_KEY;
const { callTool, score } = await import("../server.mjs");
const pass = (s) => console.log("PASS " + s);

assert.ok(score("Disneyland Resort", { name: "Disneyland Resort", type: "DESTINATION" }) === 1);
assert.ok(score("Disneyland Resort", { name: "Disneyland Park", type: "PARK" }) < 0.98);
assert.ok(score("Walt Disney World", { name: "Walt Disney World® Resort", type: "DESTINATION" }) > score("Walt Disney World", { name: "Walt Disney World Park", type: "PARK" }));
assert.ok(score("Islands of Adventure", { name: "Universal Islands of Adventure", type: "PARK" }) >= 0.9);
pass("scoring tiers: exact > same words > prefix; resort-ish names prefer the destination");

let r = await callTool("themeparks_find", { query: "Space Mountain", within: "Disneyland Resort" });
assert.equal(r.isError, false, JSON.stringify(r.payload));
assert.equal(r.payload.within.id, DLR);
r = await callTool("themeparks_live", { entity: "Disneyland Park" });
assert.equal(r.payload.error, "ambiguous");
pass('within "Disneyland Resort" resolves to the resort; two exact "Disneyland Park" names stay ambiguous');

r = await callTool("themeparks_find", { within: "Walt Disney World", type: "PARK" });
assert.deepEqual(r.payload.matches.map((m) => [m.name, m.park, m.destination]), [["Magic Kingdom Park", "Magic Kingdom Park", "Walt Disney World® Resort"]]);
r = await callTool("themeparks_find", { within: "Walt Disney World", type: "ATTRACTION" });
assert.deepEqual(r.payload.matches.map((m) => [m.park, m.destination]), [["Magic Kingdom Park", "Walt Disney World® Resort"]]);
pass("find within a resort: PARK's park is itself, destination is the resort; rides keep their park");

r = await callTool("themeparks_live", { entity: "Space Mountain", include_forecast: true });
const byPark = Object.fromEntries(r.payload.items.map((i) => [i.park, i]));
assert.equal(byPark["Magic Kingdom Park"].timezone, "America/New_York");
assert.match(byPark["Magic Kingdom Park"].bestTimeToRide.startLocal ?? byPark["Magic Kingdom Park"].bestTimeToRide.reason, /E[SD]T|No forecast/);
assert.equal(byPark["Disneyland Park"].timezone, "America/Los_Angeles");
pass("same-name group: each item uses its own park timezone");

r = await callTool("themeparks_uptime", { entity: NF, granularity: "changes", from: "2026-10-11T16:00", to: "2026-10-11T18:00" });
assert.equal(r.isError, false, JSON.stringify(r.payload));
assert.deepEqual(r.payload.intervals.map((i) => [i.status, i.startLocal, i.endLocal, i.minutes]), [
  ["DOWN", "Oct 11, 4:00:00 PM EDT", "Oct 11, 4:07:29 PM EDT", 7],
  ["OPERATING", "Oct 11, 4:07:29 PM EDT", "Oct 11, 4:49:32 PM EDT", 42],
  ["DOWN", "Oct 11, 4:49:32 PM EDT", "Oct 11, 5:11:47 PM EDT", 22],
  ["OPERATING", "Oct 11, 5:11:47 PM EDT", "Oct 11, 6:00:00 PM EDT", 48],
]);
assert.deepEqual([r.payload.waitTimeline.min, r.payload.waitTimeline.max], [40, 120]);
assert.equal(r.payload.zoneNote, undefined);
pass("NightFlight 2026-10-11 4-6 PM ET (real rows): DOWN 7, OPERATING 42, DOWN 22, OPERATING 48; waits 40-120");

r = await callTool("themeparks_uptime", { entity: NF, granularity: "changes", from: "2026-10-11T16:00:00-07:00", to: "2026-10-11T18:00:00-07:00" });
assert.match(r.payload.zoneNote, /-07:00.*-04:00.*7:00:00 PM EDT/);
assert.equal(r.payload.range.fromLocal, "Oct 11, 7:00:00 PM EDT");
pass("offset that is not the park's (-07:00) is flagged with zoneNote and the park-time range it really read");

console.log("offline-regression-test: PASS");

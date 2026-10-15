#!/usr/bin/env node
/** Live MCP smoke over stdio against api.themeparks.wiki. Prints PASS/FAIL per check. Optional: --samples <file> writes real outputs; --keyed also runs key-only checks when THEMEPARKS_API_KEY is set (the key is never printed). */
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const samplesPath = process.argv.includes("--samples") ? process.argv[process.argv.indexOf("--samples") + 1] : null;
const STATUSES = ["OPERATING", "DOWN", "CLOSED", "REFURBISHMENT"];
const WDW = "e957da41-3552-4cf6-b636-5babc5cbc4e5";
const UOR = "89db5d43-c434-4097-b71f-f6869f495a22";
const SPACE_MOUNTAIN = "b2260923-9315-40fd-9c6b-44dd811dbe64";

function startServer(env, flags = []) {
  const child = spawn(process.execPath, [...flags, "./server.mjs"], { cwd: root, env, stdio: ["pipe", "pipe", "inherit"] });
  let buf = Buffer.alloc(0);
  const waiting = new Map();
  child.stdout.on("data", (chunk) => {
    buf = Buffer.concat([buf, chunk]);
    for (;;) {
      const sep = buf.indexOf("\r\n\r\n");
      if (sep === -1) return;
      const len = Number(buf.subarray(0, sep).toString().match(/Content-Length:\s*(\d+)/i)[1]);
      if (buf.length < sep + 4 + len) return;
      const msg = JSON.parse(buf.subarray(sep + 4, sep + 4 + len).toString());
      buf = buf.subarray(sep + 4 + len);
      waiting.get(msg.id)?.(msg);
    }
  });
  let next = 1;
  const rpc = (method, params) =>
    new Promise((resolve, reject) => {
      const id = next++;
      const timer = setTimeout(() => reject(new Error(`${method} timed out`)), 60_000);
      waiting.set(id, (m) => (clearTimeout(timer), resolve(m)));
      const body = Buffer.from(JSON.stringify({ jsonrpc: "2.0", id, method, params }));
      child.stdin.write(Buffer.concat([Buffer.from(`Content-Length: ${body.length}\r\n\r\n`), body]));
    });
  const call = async (name, args) => {
    const m = await rpc("tools/call", { name, arguments: args });
    return { isError: m.result?.isError, p: JSON.parse(m.result?.content?.[0]?.text ?? "null") };
  };
  return { child, rpc, call };
}

const results = [];
const samples = {};
async function check(name, fn) {
  try {
    const detail = await fn();
    results.push({ name, ok: true });
    console.log(`PASS ${name}${detail ? ` :: ${detail}` : ""}`);
  } catch (err) {
    results.push({ name, ok: false });
    console.log(`FAIL ${name} :: ${err.message}`);
  }
}
function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}
const todayET = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
const waitLine = (items) => items.map((i) => `${i.name}=${i.standbyWait ?? "-"}m ${i.status}`).join("; ");

const env = { ...process.env };
delete env.THEMEPARKS_API_KEY;
const { child, rpc, call } = startServer(env);

await check("initialize serverInfo", async () => {
  const m = await rpc("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "themeparks-web-smoke", version: "0.1.3" } });
  assert(m.result.serverInfo.name === "themeparks-web" && m.result.serverInfo.version === "0.1.3", JSON.stringify(m.result.serverInfo));
  return `${m.result.serverInfo.name} ${m.result.serverInfo.version}`;
});

await check("tools/list exactly 4 tools", async () => {
  const names = (await rpc("tools/list", {})).result.tools.map((t) => t.name).sort();
  assert(names.join() === "themeparks_find,themeparks_live,themeparks_schedule,themeparks_uptime", names.join());
  return names.join(", ");
});

await check("find Walt Disney World", async () => {
  const { isError, p } = await call("themeparks_find", { query: "Walt Disney World" });
  assert(!isError && p.matches[0].id === WDW && p.matches[0].type === "DESTINATION", JSON.stringify(p).slice(0, 300));
  return `${p.matches[0].name} ${p.matches[0].id}`;
});

await check("find Universal Orlando", async () => {
  const { isError, p } = await call("themeparks_find", { query: "Universal Orlando" });
  assert(!isError && p.matches[0].id === UOR, JSON.stringify(p).slice(0, 300));
  return `${p.matches[0].name} ${p.matches[0].id}`;
});

await check("find Space Mountain within WDW", async () => {
  const { isError, p } = await call("themeparks_find", { query: "Space Mountain", within: "Walt Disney World" });
  assert(!isError && p.matches[0].id === SPACE_MOUNTAIN && p.matches[0].park === "Magic Kingdom Park", JSON.stringify(p).slice(0, 300));
  return `${p.matches[0].name} @ ${p.matches[0].park}`;
});

await check("find Space Mountain with no within (all-resort search)", async () => {
  const { isError, p } = await call("themeparks_find", { query: "Space Mountain" });
  assert(!isError && p.matches.some((m) => m.id === SPACE_MOUNTAIN) && p.scan.destinationsScanned < p.scan.destinationsTotal, JSON.stringify(p).slice(0, 400));
  samples.find_space_mountain_no_within = p;
  return `${p.totalMatched} matches, scanned ${p.scan.destinationsScanned}/${p.scan.destinationsTotal}: ${p.matches.map((m) => `${m.name} @ ${m.park} (${m.score})`).join("; ")}`;
});

await check("find VelociCoaster with no within", async () => {
  const { isError, p } = await call("themeparks_find", { query: "VelociCoaster" });
  assert(!isError && p.matches[0].park === "Universal Islands of Adventure", JSON.stringify(p).slice(0, 400));
  samples.find_velocicoaster_no_within = p;
  return `${p.matches[0].name} @ ${p.matches[0].park}, scanned ${p.scan.destinationsScanned}/${p.scan.destinationsTotal}`;
});

await check("live VelociCoaster with no within", async () => {
  const { isError, p } = await call("themeparks_live", { entity: "VelociCoaster" });
  assert(!isError && p.items.length === 1 && p.items[0].name === "Jurassic World VelociCoaster", JSON.stringify(p).slice(0, 400));
  samples.live_velocicoaster_no_within = p.items[0];
  return `${p.items[0].status} standby=${p.items[0].standbyWait} lastUpdated=${p.items[0].lastUpdated}`;
});

await check("live Space Mountain with no within shows every same-name ride", async () => {
  const { isError, p } = await call("themeparks_live", { entity: "Space Mountain" });
  assert(!isError && p.entity.type === "SAME_NAME_GROUP" && p.items.some((i) => i.id === SPACE_MOUNTAIN) && p.items.length >= 2, JSON.stringify(p).slice(0, 400));
  samples.live_space_mountain_no_within = { entity: p.entity, items: p.items.map(({ name, park, status, standbyWait, lastUpdated }) => ({ name, park, status, standbyWait, lastUpdated })) };
  return p.items.map((i) => `${i.park}: ${i.status} ${i.standbyWait ?? "-"}m`).join("; ");
});

await check("uptime Space Mountain with no within asks which one", async () => {
  const { isError, p } = await call("themeparks_uptime", { entity: "Space Mountain" });
  assert(isError && p.error === "ambiguous" && p.candidates.length >= 2, JSON.stringify(p).slice(0, 300));
  return p.candidates.slice(0, 2).map((c) => c.park).join(" vs ");
});

await check("find no args lists destinations", async () => {
  const { isError, p } = await call("themeparks_find", {});
  assert(!isError && p.count > 100 && p.destinations.every((d) => d.id && Array.isArray(d.parks)), `count=${p?.count}`);
  return `${p.count} destinations`;
});

await check("find within Magic Kingdom type=RESTAURANT", async () => {
  const { isError, p } = await call("themeparks_find", { within: "Magic Kingdom", type: "RESTAURANT", limit: 500 });
  assert(!isError && p.totalMatched > 0 && p.matches.every((m) => m.type === "RESTAURANT"), JSON.stringify(p).slice(0, 300));
  return `${p.totalMatched} restaurants`;
});

for (const [label, entity] of [["Magic Kingdom", "Magic Kingdom"], ["Islands of Adventure", "Islands of Adventure"]]) {
  await check(`live ${label} attractions sorted by wait`, async () => {
    const { isError, p } = await call("themeparks_live", { entity, type: "ATTRACTION", limit: 50 });
    assert(!isError && p.items.length > 0, JSON.stringify(p).slice(0, 300));
    assert(p.items.every((i) => i.type === "ATTRACTION" && STATUSES.includes(i.status) && i.lastUpdated), "bad item shape");
    const waits = p.items.map((i) => i.standbyWait ?? -1);
    assert(waits.every((w, k) => k === 0 || waits[k - 1] >= w), "not sorted wait_desc");
    samples[`live_${label}`] = { fetchedAt: p.fetchedAt, counts: p.counts, top: p.items.slice(0, 5) };
    return `counts=${JSON.stringify(p.counts)} top: ${waitLine(p.items.slice(0, 5))}`;
  });
}

await check("live Universal Orlando status=DOWN,CLOSED", async () => {
  const { isError, p } = await call("themeparks_live", { entity: "Universal Orlando", status: "DOWN,CLOSED", type: "ATTRACTION", sort: "status", limit: 100 });
  assert(!isError && p.items.every((i) => i.status === "DOWN" || i.status === "CLOSED"), JSON.stringify(p).slice(0, 300));
  assert(p.totalMatched === p.counts.DOWN + p.counts.CLOSED, "totalMatched != DOWN+CLOSED");
  const down = p.items.filter((i) => i.status === "DOWN");
  samples.live_uor_down = { fetchedAt: p.fetchedAt, counts: p.counts, down };
  return `counts=${JSON.stringify(p.counts)} DOWN: ${down.map((i) => `${i.name} (${i.park})`).join("; ") || "none right now"}`;
});

await check("live Magic Kingdom max_wait=20", async () => {
  const { isError, p } = await call("themeparks_live", { entity: "Magic Kingdom", type: "ATTRACTION", max_wait: 20, sort: "wait_asc" });
  assert(!isError && p.items.every((i) => i.standbyWait !== null && i.standbyWait <= 20), JSON.stringify(p).slice(0, 300));
  return `${p.totalMatched} rides at <=20m`;
});

await check("live single attraction Space Mountain", async () => {
  const { isError, p } = await call("themeparks_live", { entity: "Space Mountain", within: "Magic Kingdom" });
  assert(!isError && p.items.length === 1 && p.items[0].id === SPACE_MOUNTAIN, JSON.stringify(p).slice(0, 300));
  samples.live_space_mountain = p.items[0];
  const i = p.items[0];
  return `${i.status} standby=${i.standbyWait} lastUpdated=${i.lastUpdated} forecast=${i.forecast?.length ?? 0}h hours=${i.operatingHours?.length ?? 0}`;
});

await check("live 60s cache hit on repeat", async () => {
  const { p } = await call("themeparks_live", { entity: "Magic Kingdom", type: "ATTRACTION", limit: 1 });
  assert(p.cached === true, `cached=${p.cached}`);
  return `fetchedAt=${p.fetchedAt}`;
});

await check("schedule Magic Kingdom today+2", async () => {
  const { isError, p } = await call("themeparks_schedule", { entity: "Magic Kingdom", days: 3, include_purchases: true });
  assert(!isError && p.range.from === todayET && p.days.length > 0, JSON.stringify(p).slice(0, 300));
  assert(p.days.every((d) => d.date >= p.range.from && d.date <= p.range.to), "date out of range");
  samples.schedule_mk = p.days.map((d) => ({ date: d.date, entries: d.entries.map(({ purchases, ...e }) => ({ ...e, purchases: purchases?.length })) }));
  return p.days.map((d) => `${d.date}: ${d.entries.map((e) => `${e.type} ${e.open.slice(11, 16)}-${e.close.slice(11, 16)}`).join(", ")}`).join(" | ");
});

await check("schedule Islands of Adventure type=OPERATING", async () => {
  const { isError, p } = await call("themeparks_schedule", { entity: "Islands of Adventure", days: 3, type: "OPERATING" });
  assert(!isError && p.days.every((d) => d.entries.every((e) => e.type === "OPERATING")), JSON.stringify(p).slice(0, 300));
  return p.days.map((d) => `${d.date} ${d.entries[0].open.slice(11, 16)}-${d.entries[0].close.slice(11, 16)}`).join(" | ");
});

await check("schedule single ride falls back to live times", async () => {
  const { isError, p } = await call("themeparks_schedule", { entity: SPACE_MOUNTAIN });
  assert(!isError && p.note && p.todayFromLive?.id === SPACE_MOUNTAIN, JSON.stringify(p).slice(0, 300));
  return p.note;
});

await check("uptime Space Mountain last 7 days", async () => {
  const { isError, p } = await call("themeparks_uptime", { entity: "Space Mountain", within: "Magic Kingdom" });
  assert(!isError && p.days.length > 0 && p.days.length <= 7, JSON.stringify(p).slice(0, 300));
  assert(p.summary.uptimePct === null || (p.summary.uptimePct >= 0 && p.summary.uptimePct <= 100), "uptimePct out of range");
  samples.uptime_space_mountain = { range: p.range, summary: p.summary, days: p.days.map(({ date, uptimePct, downMinutes, standby }) => ({ date, uptimePct, downMinutes, p50: standby?.p50 })) };
  return `summary=${JSON.stringify(p.summary)}`;
});

await check("uptime Magic Kingdom ranks rides by downtime", async () => {
  const { isError, p } = await call("themeparks_uptime", { entity: "Magic Kingdom", days: 3, limit: 5 });
  assert(!isError && p.entities.length > 0, JSON.stringify(p).slice(0, 300));
  const down = p.entities.map((e) => e.downMinutes);
  assert(down.every((d, k) => k === 0 || down[k - 1] >= d), "not sorted down_desc");
  samples.uptime_mk_top_down = p.entities.map(({ name, uptimePct, downMinutes }) => ({ name, uptimePct, downMinutes }));
  return p.entities.map((e) => `${e.name} ${e.uptimePct}% (${e.downMinutes}m down)`).join("; ");
});

await check("uptime beyond keyless window -> history_window_exceeded", async () => {
  const { isError, p } = await call("themeparks_uptime", { entity: SPACE_MOUNTAIN, from: "2026-09-01", to: "2026-09-02" });
  assert(isError && p.error === "history_window_exceeded" && p.earliestAllowedDate && p.hint, JSON.stringify(p));
  return `${p.message} earliest=${p.earliestAllowedDate}`;
});

await check("bad name -> not_found", async () => {
  const { isError, p } = await call("themeparks_live", { entity: "Narnia World" });
  assert(isError && p.error === "not_found" && p.hint, JSON.stringify(p));
  return p.message;
});

await check("unknown UUID -> upstream 404 not_found", async () => {
  const { isError, p } = await call("themeparks_live", { entity: "00000000-0000-0000-0000-000000000000" });
  assert(isError && p.error === "not_found" && p.status === 404, JSON.stringify(p));
  return p.message;
});

await check("ambiguous name -> candidates", async () => {
  const { isError, p } = await call("themeparks_live", { entity: "Disneyland Park" });
  assert(isError && p.error === "ambiguous" && p.candidates.length >= 2, JSON.stringify(p).slice(0, 300));
  return p.candidates.slice(0, 2).map((c) => `${c.name} (${c.destination})`).join(" vs ");
});

await check("bad flag value -> bad_request", async () => {
  const { isError, p } = await call("themeparks_live", { entity: "Magic Kingdom", status: "BROKEN" });
  assert(isError && p.error === "bad_request", JSON.stringify(p));
  return p.message;
});

const ATTR = (p) => p?.attribution?.url === "https://themeparks.wiki" && /Powered by ThemeParks\.wiki/.test(p.attribution.markdown);

await check("every result carries Powered by ThemeParks.wiki", async () => {
  const a = await call("themeparks_find", { query: "EPCOT" });
  const b = await call("themeparks_live", { entity: "Narnia World" });
  assert(ATTR(a.p) && ATTR(b.p), JSON.stringify(a.p.attribution));
  return a.p.attribution.markdown;
});

await check("BUG1 destination schedule returns park entries", async () => {
  const { isError, p } = await call("themeparks_schedule", { entity: WDW, days: 2 });
  const parks = new Set(p.days.flatMap((d) => d.entries.map((e) => e.park)));
  assert(!isError && p.days.length > 0 && parks.size >= 4, JSON.stringify(p).slice(0, 300));
  return `${p.days.length} days, parks: ${[...parks].join("; ")}`;
});

await check("BUG2 destination label correct when within is a park", async () => {
  const { isError, p } = await call("themeparks_live", { entity: "Space Mountain", within: "Magic Kingdom" });
  assert(!isError && /Walt Disney World/.test(p.entity.destination) && p.entity.park === "Magic Kingdom Park", JSON.stringify(p.entity));
  return `${p.entity.park} / ${p.entity.destination}`;
});

await check("BUG3 slug resolves directly, no scan", async () => {
  const { isError, p } = await call("themeparks_live", { entity: "seaworldorlandoresort", limit: 1 });
  assert(!isError && p.entity.type === "DESTINATION" && /SeaWorld/.test(p.entity.name), JSON.stringify(p).slice(0, 300));
  return p.entity.name;
});

await check("BUG3 unknown operator id fails fast, no scan", async () => {
  const t = Date.now();
  const { isError, p } = await call("themeparks_live", { entity: "80010190;entityType=Attraction" });
  assert(isError && p.error === "not_found" && !p.scan && Date.now() - t < 10_000, JSON.stringify(p));
  return `${Date.now() - t} ms`;
});

await check("ride details (VelociCoaster minimumHeight 130 cm)", async () => {
  const { isError, p } = await call("themeparks_find", { query: "VelociCoaster", include_details: true, limit: 1 });
  const d = p.matches[0].details;
  assert(!isError && d.attractionType === "RIDE" && d.minimumHeight === 130 && d.heightUnit === "cm" && d.location, JSON.stringify(d));
  return JSON.stringify(d);
});

await check("best time to ride at WDW (forecast with percentage)", async () => {
  const { isError, p } = await call("themeparks_live", { entity: "Space Mountain", within: "Magic Kingdom" });
  const b = p.items[0].bestTimeToRide;
  assert(!isError && b && (b.available ? b.predictedWait >= 0 && "percentage" in b : b.reason), JSON.stringify(b));
  samples.best_time_space_mountain = b;
  return b.available ? `${b.startLocal} - ${b.endLocal}: ${b.predictedWait}m (${b.percentage}%)` : b.reason;
});

await check("best time unavailable outside WDW/DLR says so", async () => {
  const { isError, p } = await call("themeparks_live", { entity: "NightFlight Expedition" });
  const b = p.items[0]?.bestTimeToRide;
  assert(!isError && b && b.available === false && /Walt Disney World/.test(b.reason), JSON.stringify(b));
  return b.reason;
});

await check("history changes: NightFlight Expedition Oct 11 4-6 PM ET", async () => {
  const { isError, p } = await call("themeparks_uptime", { entity: "NightFlight Expedition", granularity: "changes", from: "2026-10-11T16:00", to: "2026-10-11T18:00" });
  assert(!isError && p.entity.park === "Dollywood" && p.intervals.length > 0 && p.opening && p.range.from === "2026-10-11T16:00:00-04:00", JSON.stringify(p).slice(0, 400));
  samples.nightflight_oct11_4_6pm = { range: p.range, opening: p.opening, intervals: p.intervals, minutesByStatus: p.minutesByStatus, waitTimeline: p.waitTimeline };
  return `${p.intervals.map((i) => `${i.status} ${i.startLocal.split(", ")[1]}-${i.endLocal.split(", ")[1]} (${i.minutes}m)`).join("; ")} | waits ${p.waitTimeline?.min}-${p.waitTimeline?.max}m`;
});

await check("history changes: Magic Kingdom park-wide DOWN events Oct 11", async () => {
  const { isError, p } = await call("themeparks_uptime", { entity: "Magic Kingdom", granularity: "changes", date: "2026-10-11" });
  assert(!isError && p.totalEvents > 0 && p.events.every((e) => e.status === "DOWN"), JSON.stringify(p).slice(0, 300));
  samples.mk_down_oct11 = { totalEvents: p.totalEvents, byEntity: p.byEntity, events: p.events };
  return `${p.totalEvents} DOWN spans across ${p.byEntity.length} rides; worst ${p.byEntity[0].name} ${p.byEntity[0].minutes}m`;
});

await check("history changes: park range over a day -> bad_request", async () => {
  const { isError, p } = await call("themeparks_uptime", { entity: "Magic Kingdom", granularity: "changes", from: "2026-10-10T08:00", to: "2026-10-12T08:00" });
  assert(isError && p.error === "bad_request", JSON.stringify(p));
  return p.message;
});

await check("keyless coverage", async () => {
  const { isError, p } = await call("themeparks_uptime", { entity: SPACE_MOUNTAIN, granularity: "coverage" });
  assert(!isError && p.coverage && p.access.tier === "keyless", JSON.stringify(p).slice(0, 300));
  return JSON.stringify(p.coverage.kinds?.status ?? p.coverage).slice(0, 120);
});

await check("key_status without key", async () => {
  const { isError, p } = await call("themeparks_find", { mode: "key_status" });
  assert(!isError && p.keyConfigured === false && p.getAKey.signup === "https://www.themeparks.wiki/register", JSON.stringify(p));
  return p.message;
});

await check("watch without key -> key_required", async () => {
  const { isError, p } = await call("themeparks_live", { entity: SPACE_MOUNTAIN, mode: "watch" });
  assert(isError && p.error === "key_required", JSON.stringify(p));
  return p.message;
});

await check('0.1.3 within "Disneyland Resort" resolves (not ambiguous)', async () => {
  const { isError, p } = await call("themeparks_find", { query: "Space Mountain", within: "Disneyland Resort" });
  assert(!isError && p.within.type === "DESTINATION" && p.within.name === "Disneyland Resort" && p.matches[0].park === "Disneyland Park", JSON.stringify(p).slice(0, 300));
  return `${p.within.name} -> ${p.matches[0].name} @ ${p.matches[0].park}`;
});

await check("0.1.3 shared-name live uses each park's timezone", async () => {
  const { isError, p } = await call("themeparks_live", { entity: "Space Mountain", include_forecast: true });
  const mk = p.items.find((i) => i.park === "Magic Kingdom Park");
  const dl = p.items.find((i) => i.park === "Disneyland Park");
  const zone = (b) => (b?.available ? b.startLocal.match(/[A-Z]{3}$/)[0] : "n/a");
  assert(!isError && mk.timezone === "America/New_York" && dl.timezone === "America/Los_Angeles" && !/P[SD]T/.test(mk.bestTimeToRide?.startLocal ?? "") && !/E[SD]T/.test(dl.bestTimeToRide?.startLocal ?? ""), JSON.stringify({ mk: mk.bestTimeToRide, dl: dl.bestTimeToRide }));
  return `MK ${mk.bestTimeToRide?.startLocal ?? mk.bestTimeToRide?.reason} (${zone(mk.bestTimeToRide)}); DL ${dl.bestTimeToRide?.startLocal ?? dl.bestTimeToRide?.reason} (${zone(dl.bestTimeToRide)})`;
});

await check("0.1.3 find PARKs within WDW: park=itself, destination=resort", async () => {
  const { isError, p } = await call("themeparks_find", { within: "Walt Disney World", type: "PARK" });
  assert(!isError && p.matches.length >= 4 && p.matches.every((m) => m.park === m.name && /Walt Disney World/.test(m.destination)), JSON.stringify(p.matches.slice(0, 2)));
  return p.matches.map((m) => m.name).join("; ");
});

await check("0.1.3 NightFlight 4-6 PM ET exact intervals (regression)", async () => {
  const { isError, p } = await call("themeparks_uptime", { entity: "NightFlight Expedition", granularity: "changes", from: "2026-10-11T16:00", to: "2026-10-11T18:00" });
  const got = p.intervals.map((i) => `${i.status} ${i.minutes}`).join(",");
  assert(!isError && got === "DOWN 7,OPERATING 42,DOWN 22,OPERATING 48" && p.waitTimeline.min === 40 && p.waitTimeline.max === 120, got);
  return got;
});

await check("0.1.3 NightFlight full-day rows agree with the 4-6 PM range", async () => {
  const { isError, p } = await call("themeparks_uptime", { entity: "NightFlight Expedition", granularity: "changes", date: "2026-10-11" });
  const at = (t) => p.intervals.find((i) => Date.parse(i.start) <= t && t < Date.parse(i.end))?.status;
  const t0 = Date.parse("2026-10-11T16:00:00-04:00");
  assert(!isError && at(t0 + 3 * 60e3) === "DOWN" && at(t0 + 20 * 60e3) === "OPERATING" && at(t0 + 60 * 60e3) === "DOWN" && at(t0 + 90 * 60e3) === "OPERATING", JSON.stringify(p.intervals).slice(0, 400));
  return `day: ${JSON.stringify(p.minutesByStatus)}`;
});

await check("0.1.3 foreign offset flagged with zoneNote", async () => {
  const { isError, p } = await call("themeparks_uptime", { entity: "NightFlight Expedition", granularity: "changes", from: "2026-10-11T16:00:00-07:00", to: "2026-10-11T18:00:00-07:00" });
  assert(!isError && /-07:00/.test(p.zoneNote) && p.range.fromLocal === "Oct 11, 7:00:00 PM EDT", JSON.stringify(p).slice(0, 300));
  return p.zoneNote;
});

child.kill();

await check("unexpanded ${THEMEPARKS_API_KEY} placeholder treated as no key", async () => {
  const s = startServer({ ...env, THEMEPARKS_API_KEY: "${THEMEPARKS_API_KEY}" });
  await s.rpc("initialize", {});
  const { isError, p } = await s.call("themeparks_find", { query: "EPCOT" });
  s.child.kill();
  assert(!isError && p.matches[0].name === "EPCOT", JSON.stringify(p).slice(0, 300));
  return "keyless EPCOT lookup OK";
});

await check("newline-delimited framing", async () => {
  const c = spawn(process.execPath, ["./server.mjs"], { cwd: root, env, stdio: ["pipe", "pipe", "inherit"] });
  const line = await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("no LF reply")), 10_000);
    c.stdout.once("data", (d) => (clearTimeout(t), resolve(d.toString())));
    c.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) + "\n");
  });
  c.kill();
  assert(JSON.parse(line).result.tools.length === 4, line.slice(0, 200));
  return "tools/list over LF";
});

if (process.argv.includes("--keyed")) {
  const KEY = process.env.THEMEPARKS_API_KEY ?? "";
  if (!KEY || /^\$\{/.test(KEY)) {
    console.log("SKIP keyed checks: THEMEPARKS_API_KEY not set");
  } else {
    const flags = typeof globalThis.WebSocket === "function" ? [] : ["--experimental-websocket"];
    const k = startServer({ ...env, THEMEPARKS_API_KEY: KEY }, flags);
    await k.rpc("initialize", {});
    const noKey = (p) => !JSON.stringify(p).includes(KEY);
    await check("KEYED key_status reads /v1/me", async () => {
      const { isError, p } = await k.call("themeparks_find", { mode: "key_status" });
      assert(!isError && p.valid && p.plan.tier && p.plan.historyRateLimit && noKey(p), JSON.stringify(p).slice(0, 300));
      return `${p.plan.tier}, ${p.plan.historyDays}d (earliest ${p.plan.historyEarliestDate}), history ${p.plan.historyRateLimit.remaining}/${p.plan.historyRateLimit.limit}/h, rest ${p.plan.rateLimit.remaining}/${p.plan.rateLimit.limit}/min`;
    });
    await check("KEYED 30-day daily history with RateLimit-History budget", async () => {
      const { isError, p } = await k.call("themeparks_uptime", { entity: SPACE_MOUNTAIN, days: 30 });
      assert(!isError && p.days.length > 7 && p.access.source === "/v1/me" && p.historyBudget?.limit, JSON.stringify(p).slice(0, 300));
      return `${p.range.from}..${p.range.to} ${p.days.length} days uptime ${p.summary.uptimePct}%, budget ${p.historyBudget.remaining}/${p.historyBudget.limit}`;
    });
    await check("KEYED park daily 30 days", async () => {
      const { isError, p } = await k.call("themeparks_uptime", { entity: "Magic Kingdom", days: 30, limit: 3 });
      assert(!isError && p.entities.length && p.pages >= 1, JSON.stringify(p).slice(0, 300));
      return `${p.pages} page(s); ${p.entities.map((e) => `${e.name} ${e.uptimePct}%`).join("; ")}`;
    });
    await check("KEYED minute-level beyond 7 days", async () => {
      const day = new Date(Date.now() - 20 * 86_400_000).toISOString().slice(0, 10);
      const { isError, p } = await k.call("themeparks_uptime", { entity: SPACE_MOUNTAIN, granularity: "changes", date: day });
      assert(!isError && p.intervals.length > 0, JSON.stringify(p).slice(0, 300));
      return `${day}: ${JSON.stringify(p.minutesByStatus)}`;
    });
    await check("KEYED coverage", async () => {
      const { isError, p } = await k.call("themeparks_uptime", { entity: "Magic Kingdom", granularity: "coverage" });
      assert(!isError && p.coverage && p.access.tier !== "keyless", JSON.stringify(p).slice(0, 300));
      return JSON.stringify(p.coverage.summary ?? {}).slice(0, 160);
    });
    await check("KEYED watch: WebSocket snapshot + updates", async () => {
      const { isError, p } = await k.call("themeparks_live", { entity: "Magic Kingdom", mode: "watch", type: "ATTRACTION", watch_seconds: 30 });
      assert(!isError && p.connection?.protocol === "preview" && p.subscription && p.snapshot.entities > 0 && noKey(p), JSON.stringify(p).slice(0, 400));
      samples.watch_mk = { connection: p.connection, snapshot: p.snapshot, updateCount: p.updateCount, updates: p.updates.slice(0, 5), stopReason: p.stopReason };
      return `limits=${JSON.stringify(p.connection.limits)} snapshot=${p.snapshot.entities} updates=${p.updateCount} in ${p.watchedSeconds}s (${p.stopReason})`;
    });
    await check("KEYED watch single ride stops when condition already met", async () => {
      const { isError, p } = await k.call("themeparks_live", { entity: SPACE_MOUNTAIN, mode: "watch", until_status: "OPERATING,CLOSED,DOWN,REFURBISHMENT", stop_if_already_met: true, watch_seconds: 20 });
      assert(!isError && p.stopReason === "condition_met" && p.triggeredBy, JSON.stringify(p).slice(0, 400));
      return `${p.triggeredBy.name} ${p.triggeredBy.status} after ${p.watchedSeconds}s`;
    });
    k.child.kill();
  }
}

if (samplesPath) writeFileSync(samplesPath, JSON.stringify(samples, null, 2));
const failed = results.filter((r) => !r.ok).length;
console.log(`\nsmoke: ${results.length - failed}/${results.length} PASS`);
process.exit(failed ? 1 : 0);

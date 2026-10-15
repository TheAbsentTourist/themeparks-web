#!/usr/bin/env node
/** Live MCP smoke over stdio against api.themeparks.wiki. Prints PASS/FAIL per check. Optional: --samples <file> writes real outputs. */
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

function startServer(env) {
  const child = spawn(process.execPath, ["./server.mjs"], { cwd: root, env, stdio: ["pipe", "pipe", "inherit"] });
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
  const m = await rpc("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "themeparks-web-smoke", version: "0.1.1" } });
  assert(m.result.serverInfo.name === "themeparks-web" && m.result.serverInfo.version === "0.1.1", JSON.stringify(m.result.serverInfo));
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

if (samplesPath) writeFileSync(samplesPath, JSON.stringify(samples, null, 2));
const failed = results.filter((r) => !r.ok).length;
console.log(`\nsmoke: ${results.length - failed}/${results.length} PASS`);
process.exit(failed ? 1 : 0);

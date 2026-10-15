#!/usr/bin/env node
/**
 * themeparks-web: zero-dependency stdio MCP over the ThemeParks.wiki v1 API.
 * Tools come from TOOL_REGISTRY. Queue kinds come from QUEUE_FIELDS.
 * Keyless by default. THEMEPARKS_API_KEY, when set, is sent as x-api-key.
 */
import { stdin, stdout } from "node:process";
import { pathToFileURL } from "node:url";

const VERSION = "0.1.1";
const PROTOCOL_VERSION = "2024-11-05";
const SERVER_INFO = { name: "themeparks-web", version: VERSION };
const API = "https://api.themeparks.wiki/v1";
const UA = `ThemeParksWebPlugin/${VERSION} (+https://github.com/TheAbsentTourist; chucktastictime@gmail.com)`;
const SOURCE = "ThemeParks.wiki (unofficial; data from park apps)";
const TIMEOUT_MS = 20_000;
const LIVE_TTL_MS = 60_000;
const DEFAULT_TTL_MS = 300_000;
const CHILDREN_TTL_MS = 6 * 60 * 60_000;
const SCAN_CONCURRENCY = 4;
const STRONG_MATCH = 0.9;
const TIER_STOP = 0.8;
const MAJOR_RESORTS = /walt disney world|disneyland|tokyo disney|shanghai disney|hong kong disney|universal|seaworld|busch gardens|europa-park|efteling|cedar point|knott|legoland florida|six flags magic mountain|dollywood/i;
const STALE_AFTER_MINUTES = 24 * 60;
const MATCH_THRESHOLD = 0.5;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const YMD = /^\d{4}-\d{2}-\d{2}$/;

const ENTITY_TYPES = ["DESTINATION", "PARK", "ATTRACTION", "SHOW", "RESTAURANT", "HOTEL"];
const STATUSES = ["OPERATING", "DOWN", "CLOSED", "REFURBISHMENT"];
const SCHEDULE_TYPES = ["OPERATING", "TICKETED_EVENT", "PRIVATE_EVENT", "EXTRA_HOURS", "INFO"];

class ToolError extends Error {
  constructor(code, message, extra = {}) {
    super(message);
    this.code = code;
    this.extra = extra;
  }
}

function apiKey() {
  const key = String(process.env.THEMEPARKS_API_KEY ?? "").trim();
  return key && !/^\$\{.*\}$/.test(key) ? key : "";
}

// ---------------------------------------------------------------------------
// HTTP boundary: cache, 429, upstream error shapes
// ---------------------------------------------------------------------------

const cache = new Map();
const inflight = new Map();

async function api(path) {
  const ttl = /\/live(\?|$)/.test(path) ? LIVE_TTL_MS : path.endsWith("/children") ? CHILDREN_TTL_MS : DEFAULT_TTL_MS;
  const hit = cache.get(path);
  if (hit && Date.now() - hit.at < ttl) return { data: hit.data, fetchedAt: new Date(hit.at).toISOString(), cached: true };
  if (inflight.has(path)) return inflight.get(path);
  const p = fetchFresh(path, hit).finally(() => inflight.delete(path));
  inflight.set(path, p);
  return p;
}

async function fetchFresh(path, hit) {
  const headers = { Accept: "application/json", "User-Agent": UA };
  const key = apiKey();
  if (key) headers["x-api-key"] = key;
  const staleFrom = (reason) => ({ data: hit.data, fetchedAt: new Date(hit.at).toISOString(), cached: true, staleBecause: reason });
  let res;
  try {
    res = await fetch(API + path, { headers, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (err) {
    if (hit) return staleFrom("network_error");
    throw new ToolError("network_error", `Could not reach ThemeParks.wiki: ${err?.message || err}`);
  }
  const body = await res.json().catch(() => null);
  if (res.status === 429) {
    const retryAfterSeconds = Number(body?.retryAfter ?? res.headers.get("retry-after")) || 60;
    if (hit) return staleFrom("rate_limited");
    throw new ToolError("rate_limited", `ThemeParks.wiki rate limit reached. Retry in ${retryAfterSeconds}s.`, {
      retryAfterSeconds,
      hint: apiKey() ? undefined : "A free THEMEPARKS_API_KEY raises the history budget from 60 to 600 calls per hour.",
    });
  }
  if (!res.ok) {
    const e = body?.error;
    const type = typeof e === "object" && e ? e.type : e;
    const message = (typeof e === "object" && e?.message) || body?.message || `HTTP ${res.status}`;
    const code = res.status === 404 ? "not_found" : type === "HISTORY_WINDOW_EXCEEDED" ? "history_window_exceeded" : "upstream_error";
    throw new ToolError(code, message, {
      status: res.status,
      upstreamType: type || undefined,
      earliestAllowedDate: e?.earliestAllowedDate,
    });
  }
  const at = Date.now();
  cache.set(path, { at, data: body });
  return { data: body, fetchedAt: new Date(at).toISOString(), cached: false };
}

// ---------------------------------------------------------------------------
// Domain: Entity refs and fuzzy name resolution
// ---------------------------------------------------------------------------

const STOPWORDS = new Set(["the", "park", "parks", "resort", "theme", "and", "of", "at"]);

function normalize(s) {
  return String(s ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[®™©]/g, "")
    .replace(/['’‘`]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function tokens(s) {
  const all = normalize(s).split(" ").filter(Boolean);
  const kept = all.filter((t) => !STOPWORDS.has(t));
  return kept.length ? kept : all;
}

function score(query, ref) {
  const q = normalize(query);
  if (!q) return 0;
  if (q === normalize(ref.name) || q === normalize(ref.slug)) return 1;
  const qt = tokens(query);
  const ct = tokens(ref.name);
  if (qt.join(" ") === ct.join(" ")) return 0.98;
  const has = (t) => ct.some((c) => c === t || (t.length >= 3 && c.startsWith(t)));
  const hits = qt.filter(has).length;
  if (hits === qt.length) return 0.8 + 0.15 * (qt.length / Math.max(ct.length, qt.length));
  if (normalize(ref.name).includes(q)) return 0.7;
  return 0.6 * (hits / qt.length);
}

function rank(query, pool) {
  return pool
    .map((ref) => ({ ref, score: Math.round(score(query, ref) * 100) / 100 }))
    .filter((r) => r.score >= MATCH_THRESHOLD)
    .sort((a, b) => b.score - a.score || a.ref.name.localeCompare(b.ref.name));
}

async function catalog() {
  const { data } = await api("/destinations");
  const refs = [];
  for (const d of data?.destinations ?? []) {
    refs.push({ id: d.id, name: d.name, type: "DESTINATION", slug: d.slug ?? null });
    for (const p of d.parks ?? []) refs.push({ id: p.id, name: p.name, type: "PARK", destination: d.name, destinationId: d.id });
  }
  return refs;
}

async function parkNames() {
  return new Map((await catalog()).filter((r) => r.type === "PARK").map((r) => [r.id, r.name]));
}

async function childrenOf(parent) {
  const [{ data }, parks] = await Promise.all([api(`/entity/${parent.id}/children`), parkNames()]);
  return (data?.children ?? []).map((c) => ({
    id: c.id,
    name: c.name,
    type: c.entityType,
    slug: c.slug ?? null,
    park: parks.get(c.parentId) ?? (c.parentId === parent.id ? parent.name : undefined),
  }));
}

async function searchEverywhere(query, keep = () => true) {
  const destinations = (await catalog()).filter((r) => r.type === "DESTINATION");
  const tiers = [destinations.filter((d) => MAJOR_RESORTS.test(d.name)), destinations.filter((d) => !MAJOR_RESORTS.test(d.name))];
  const hits = [];
  let scanned = 0;
  let stoppedBy = null;
  for (const tier of tiers) {
    const queue = [...tier];
    const worker = async () => {
      while (queue.length && !stoppedBy) {
        const d = queue.shift();
        try {
          for (const ref of await childrenOf(d)) {
            if (keep(ref)) hits.push({ ref: { ...ref, destination: d.name }, score: Math.round(score(query, ref) * 100) / 100 });
          }
          scanned++;
        } catch (err) {
          if (err instanceof ToolError && err.code === "rate_limited") stoppedBy = "rate_limited";
        }
      }
    };
    await Promise.all(Array.from({ length: SCAN_CONCURRENCY }, worker));
    if (stoppedBy || hits.some((h) => h.score >= TIER_STOP)) break;
  }
  const ranked = hits.filter((h) => h.score >= MATCH_THRESHOLD).sort((a, b) => b.score - a.score || a.ref.name.localeCompare(b.ref.name));
  return { ranked, scan: { destinationsScanned: scanned, destinationsTotal: destinations.length, stoppedBy: stoppedBy ?? undefined } };
}

async function rankAnywhere(query, keep = () => true) {
  const local = rank(query, (await catalog()).filter(keep));
  if (local[0]?.score >= STRONG_MATCH) return { ranked: local };
  const { ranked, scan } = await searchEverywhere(query, keep);
  return { ranked: [...ranked, ...local].sort((a, b) => b.score - a.score), scan };
}

async function entityDetails(id) {
  const { data } = await api(`/entity/${encodeURIComponent(id)}`);
  return {
    id: data.id,
    name: data.name,
    type: data.entityType,
    slug: data.slug ?? null,
    timezone: data.timezone ?? null,
    parentId: data.parentId ?? null,
    destinationId: data.destinationId ?? null,
  };
}

async function resolve(ref, within) {
  const text = typeof ref === "string" ? ref.trim() : "";
  if (!text) throw new ToolError("bad_request", "entity is required (a name like \"Magic Kingdom\" or a ThemeParks.wiki id).");
  if (UUID.test(text)) return entityDetails(text);
  const parent = within ? await resolve(within) : null;
  const { ranked, scan } = parent ? { ranked: rank(text, await childrenOf(parent)) } : await rankAnywhere(text);
  if (!ranked.length) {
    throw new ToolError("not_found", `Nothing ${parent ? `in ${parent.name} ` : ""}matches "${text}".`, {
      scan,
      hint: scan?.stoppedBy
        ? "The all-resort search stopped at the rate limit. Retry shortly or pass within=<park or resort>."
        : "Try a shorter query or pass within=<park or resort>.",
    });
  }
  const [top, second] = ranked;
  if (second && top.score >= 0.9 && top.score - second.score < 0.05 && top.ref.id !== second.ref.id) {
    throw new ToolError("ambiguous", `"${text}" matches several entities. Pass one id, or narrow with within.`, {
      candidates: ranked.slice(0, 8).map(entityOut),
    });
  }
  return { ...(await entityDetails(top.ref.id)), park: top.ref.park, destination: top.ref.destination ?? parent?.name, matchScore: top.score };
}

function entityOut({ ref, score: s }) {
  return { id: ref.id, name: ref.name, type: ref.type, park: ref.park, destination: ref.destination, slug: ref.slug ?? undefined, score: s };
}

// ---------------------------------------------------------------------------
// Domain: LiveStatus
// ---------------------------------------------------------------------------

const returnWindow = (q) => ({ state: q?.state ?? null, start: q?.returnStart ?? null, end: q?.returnEnd ?? null });

const QUEUE_FIELDS = {
  STANDBY: (q) => ({ standbyWait: q?.waitTime ?? null }),
  SINGLE_RIDER: (q) => ({ singleRiderWait: q?.waitTime ?? null }),
  PAID_STANDBY: (q) => ({ paidStandbyWait: q?.waitTime ?? null }),
  RETURN_TIME: (q) => ({ returnTime: returnWindow(q) }),
  PAID_RETURN_TIME: (q) => ({ paidReturnTime: { ...returnWindow(q), price: q?.price?.formatted ?? null } }),
  BOARDING_GROUP: (q) => ({
    boardingGroup: {
      state: q?.allocationStatus ?? null,
      currentGroupStart: q?.currentGroupStart ?? null,
      currentGroupEnd: q?.currentGroupEnd ?? null,
      nextAllocationTime: q?.nextAllocationTime ?? null,
      estimatedWait: q?.estimatedWait ?? null,
    },
  }),
};

function toLiveStatus(raw, { parks, now, includeForecast, includeTimes }) {
  const queues = {};
  const otherQueues = {};
  for (const [kind, q] of Object.entries(raw.queue ?? {})) {
    if (QUEUE_FIELDS[kind]) Object.assign(queues, QUEUE_FIELDS[kind](q));
    else otherQueues[kind] = q;
  }
  const ageMinutes = raw.lastUpdated ? Math.round((now - Date.parse(raw.lastUpdated)) / 60_000) : null;
  const out = {
    id: raw.id,
    name: raw.name,
    type: raw.entityType,
    park: parks.get(raw.parkId),
    status: raw.status ?? null,
    standbyWait: null,
    ...queues,
    lastUpdated: raw.lastUpdated ?? null,
    ageMinutes,
  };
  if (ageMinutes !== null && ageMinutes > STALE_AFTER_MINUTES) out.stale = true;
  if (Object.keys(otherQueues).length) out.otherQueues = otherQueues;
  if (raw.diningAvailability?.length) out.diningAvailability = raw.diningAvailability;
  if (includeTimes) {
    if (raw.showtimes?.length) out.showtimes = raw.showtimes.map(({ type, startTime, endTime }) => ({ type, start: startTime, end: endTime }));
    if (raw.operatingHours?.length) out.operatingHours = raw.operatingHours.map(({ type, startTime, endTime }) => ({ type, start: startTime, end: endTime }));
  }
  if (includeForecast && raw.forecast?.length) out.forecast = raw.forecast.map(({ time, waitTime }) => ({ time, waitTime }));
  return out;
}

const SORTS = {
  wait_desc: (a, b) => (b.standbyWait ?? -1) - (a.standbyWait ?? -1),
  wait_asc: (a, b) => (a.standbyWait ?? Infinity) - (b.standbyWait ?? Infinity),
  name: (a, b) => a.name.localeCompare(b.name),
  status: (a, b) => STATUSES.indexOf(a.status) - STATUSES.indexOf(b.status) || a.name.localeCompare(b.name),
};

// ---------------------------------------------------------------------------
// Argument parsing (boundary)
// ---------------------------------------------------------------------------

function list(v, allowed, name) {
  if (v === undefined || v === null || v === "") return null;
  const items = (Array.isArray(v) ? v : String(v).split(",")).map((s) => String(s).trim().toUpperCase()).filter(Boolean);
  const bad = items.filter((s) => !allowed.includes(s));
  if (bad.length) throw new ToolError("bad_request", `${name} must be one of ${allowed.join(", ")}; got ${bad.join(", ")}.`);
  return new Set(items);
}

function int(v, { min, max, def, name }) {
  if (v === undefined || v === null || v === "") return def;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new ToolError("bad_request", `${name} must be a number.`);
  return Math.min(max, Math.max(min, Math.round(n)));
}

function ymd(v, name) {
  if (v === undefined || v === null || v === "") return null;
  if (!YMD.test(String(v))) throw new ToolError("bad_request", `${name} must be YYYY-MM-DD.`);
  return String(v);
}

function todayIn(tz) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz || "UTC", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

function addDays(day, n) {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function daysBetween(a, b) {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

const entityHeader = (e) => ({ id: e.id, name: e.name, type: e.type, park: e.park, destination: e.destination, timezone: e.timezone ?? undefined, matchScore: e.matchScore });

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

const ENTITY_ARG = { type: "string", description: "Name (fuzzy, e.g. \"Magic Kingdom\", \"Space Mountain\") or ThemeParks.wiki id." };
const WITHIN_ARG = {
  type: "string",
  description: "Optional resort or park to search inside, e.g. \"Walt Disney World\". Without it, ride names are searched across major resorts first, then all destinations.",
};

async function findTool(args) {
  const query = typeof args.query === "string" ? args.query.trim() : "";
  const types = list(args.type, ENTITY_TYPES, "type");
  const parent = args.within ? await resolve(args.within) : null;
  if (!query && !parent) {
    const { data, fetchedAt } = await api("/destinations");
    const destinations = (data?.destinations ?? []).map((d) => ({ id: d.id, name: d.name, slug: d.slug, parks: d.parks }));
    return { source: SOURCE, fetchedAt, count: destinations.length, destinations };
  }
  const keep = (r) => !types || types.has(r.type);
  const pool = parent ? (await childrenOf(parent)).filter(keep) : [];
  const limit = int(args.limit, { min: 1, max: 500, def: query ? 10 : 100, name: "limit" });
  const global = query && !parent ? await rankAnywhere(query, keep) : null;
  const matches = global
    ? global.ranked.map(entityOut)
    : query
    ? rank(query, pool).map(entityOut)
    : pool.map((ref) => ({ id: ref.id, name: ref.name, type: ref.type, park: ref.park, slug: ref.slug ?? undefined })).sort((a, b) => a.name.localeCompare(b.name));
  return {
    source: SOURCE,
    within: parent ? entityHeader(parent) : undefined,
    query: query || undefined,
    scan: global?.scan,
    totalMatched: matches.length,
    matches: matches.slice(0, limit),
  };
}

async function resolveOrSameName(ref, within) {
  try {
    return { entity: await resolve(ref, within), sameName: null };
  } catch (err) {
    const same = err instanceof ToolError && err.code === "ambiguous"
      ? err.extra.candidates.filter((c) => c.score >= 0.98 && !["PARK", "DESTINATION"].includes(c.type))
      : [];
    if (same.length < 2) throw err;
    return { entity: null, sameName: same };
  }
}

async function liveTool(args) {
  const { entity, sameName } = await resolveOrSameName(args.entity, args.within);
  const types = list(args.type, ENTITY_TYPES, "type");
  const statuses = list(args.status, STATUSES, "status");
  const minWait = args.min_wait === undefined ? null : int(args.min_wait, { min: 0, max: 1440, def: null, name: "min_wait" });
  const maxWait = args.max_wait === undefined ? null : int(args.max_wait, { min: 0, max: 1440, def: null, name: "max_wait" });
  const sort = args.sort ?? "wait_desc";
  if (!SORTS[sort]) throw new ToolError("bad_request", `sort must be one of ${Object.keys(SORTS).join(", ")}.`);
  const limit = int(args.limit, { min: 1, max: 500, def: 30, name: "limit" });
  const single = sameName !== null || !["DESTINATION", "PARK"].includes(entity.type);
  const includeForecast = args.include_forecast ?? single;
  const includeTimes = args.include_times ?? single;

  const ids = sameName ? sameName.map((c) => c.id) : [entity.id];
  const [responses, parks] = await Promise.all([Promise.all(ids.map((id) => api(`/entity/${id}/live`))), parkNames()]);
  const { data, fetchedAt, cached, staleBecause } = responses[0];
  const rawItems = sameName
    ? responses.flatMap((r, k) => (r.data?.liveData ?? []).filter((x) => x.id === ids[k]))
    : data?.liveData ?? [];
  const now = Date.now();
  const all = rawItems
    .filter((r) => !types || types.has(r.entityType))
    .map((r) => toLiveStatus(r, { parks, now, includeForecast, includeTimes }));
  const counts = Object.fromEntries(STATUSES.map((s) => [s, all.filter((x) => x.status === s).length]));
  const matched = all
    .filter((x) => !statuses || statuses.has(x.status))
    .filter((x) => minWait === null || (x.standbyWait !== null && x.standbyWait >= minWait))
    .filter((x) => maxWait === null || (x.standbyWait !== null && x.standbyWait <= maxWait))
    .sort(SORTS[sort]);
  return {
    source: SOURCE,
    entity: sameName
      ? { name: args.entity, type: "SAME_NAME_GROUP", matches: sameName.map(({ id, name, type, park, destination }) => ({ id, name, type, park, destination })) }
      : { ...entityHeader(entity), timezone: data?.timezone ?? entity.timezone ?? undefined },
    fetchedAt,
    cached,
    staleBecause,
    counts,
    totalMatched: matched.length,
    returned: Math.min(limit, matched.length),
    items: matched.slice(0, limit),
    note: sameName
      ? `"${args.entity}" names ${sameName.length} entities at different parks. All are shown; pass within to pick one.`
      : all.length
      ? undefined
      : "ThemeParks.wiki returned no live data for this entity right now.",
  };
}

async function scheduleTool(args) {
  const entity = await resolve(args.entity, args.within);
  const tz = entity.timezone || "UTC";
  const from = ymd(args.from, "from") ?? todayIn(tz);
  const days = int(args.days, { min: 1, max: 62, def: 3, name: "days" });
  const to = addDays(from, days - 1);
  const types = list(args.type, SCHEDULE_TYPES, "type");
  const includePurchases = Boolean(args.include_purchases);

  const months = [...new Set(Array.from({ length: days }, (_, i) => addDays(from, i).slice(0, 7)))];
  const responses = await Promise.all(months.map((m) => api(`/entity/${entity.id}/schedule/${m.slice(0, 4)}/${m.slice(5, 7)}`)));
  const byDate = new Map();
  for (const { data } of responses) {
    for (const s of data?.schedule ?? []) {
      if (s.date < from || s.date > to || (types && !types.has(s.type))) continue;
      const entry = { type: s.type, open: s.openingTime, close: s.closingTime, description: s.description };
      if (includePurchases && s.purchases?.length) {
        entry.purchases = s.purchases.map((p) => ({ name: p.name, type: p.type, price: p.price?.formatted ?? null, available: p.available ?? null }));
      }
      if (!byDate.has(s.date)) byDate.set(s.date, []);
      byDate.get(s.date).push(entry);
    }
  }
  const scheduleDays = [...byDate.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, entries]) => ({ date, entries: entries.sort((a, b) => String(a.open).localeCompare(String(b.open))) }));
  const out = {
    source: SOURCE,
    entity: entityHeader(entity),
    range: { from, to, timezone: tz },
    fetchedAt: responses[0]?.fetchedAt,
    days: scheduleDays,
  };
  const missing = Array.from({ length: days }, (_, i) => addDays(from, i)).filter((d) => !byDate.has(d));
  if (missing.length) out.datesWithoutPublishedHours = missing;
  if (!scheduleDays.length && !["PARK", "DESTINATION"].includes(entity.type)) {
    const live = await api(`/entity/${entity.id}/live`);
    const raw = live.data?.liveData?.find((r) => r.id === entity.id);
    out.note = "No published schedule for this entity. Today's times from live data are shown instead.";
    out.todayFromLive = raw
      ? toLiveStatus(raw, { parks: await parkNames(), now: Date.now(), includeForecast: false, includeTimes: true })
      : null;
  }
  return out;
}

function uptimePct(operating, down) {
  const total = (operating ?? 0) + (down ?? 0);
  return total ? Math.round((1000 * operating) / total) / 10 : null;
}

function toDailyUptime(row) {
  const basis = row.inParkHours ?? row;
  return {
    date: row.date,
    uptimePct: uptimePct(basis.operatingMinutes, basis.downMinutes),
    basis: row.inParkHours ? "published_hours" : "whole_day",
    operatingMinutes: basis.operatingMinutes,
    downMinutes: basis.downMinutes,
    unknownMinutes: basis.unknownMinutes ?? null,
    scheduledMinutes: row.inParkHours?.scheduledMinutes ?? null,
    firstOperatingAt: row.firstOperatingAt ?? null,
    lastClosedAt: row.lastClosedAt ?? null,
    standby: basis.standby ?? row.standby ?? null,
  };
}

function summarize(daily) {
  const operating = daily.reduce((n, d) => n + (d.operatingMinutes ?? 0), 0);
  const down = daily.reduce((n, d) => n + (d.downMinutes ?? 0), 0);
  const withWaits = daily.filter((d) => d.standby);
  const worst = daily.filter((d) => d.uptimePct !== null).sort((a, b) => a.uptimePct - b.uptimePct)[0];
  return {
    daysWithData: daily.length,
    uptimePct: uptimePct(operating, down),
    operatingMinutes: operating,
    downMinutes: down,
    worstDay: worst ? { date: worst.date, uptimePct: worst.uptimePct, downMinutes: worst.downMinutes } : null,
    avgDailyMedianWait: withWaits.length ? Math.round(withWaits.reduce((n, d) => n + d.standby.p50, 0) / withWaits.length) : null,
  };
}

const UPTIME_SORTS = {
  down_desc: (a, b) => b.downMinutes - a.downMinutes,
  uptime_asc: (a, b) => (a.uptimePct ?? 101) - (b.uptimePct ?? 101),
  name: (a, b) => a.name.localeCompare(b.name),
};

async function uptimeTool(args) {
  const entity = await resolve(args.entity, args.within);
  const tz = entity.timezone || "UTC";
  const isGroup = ["PARK", "DESTINATION"].includes(entity.type);
  const to = ymd(args.to, "to") ?? todayIn(tz);
  const from = ymd(args.from, "from") ?? addDays(to, 1 - int(args.days, { min: 1, max: isGroup ? 31 : 366, def: 7, name: "days" }));
  if (daysBetween(from, to) < 0) throw new ToolError("bad_request", "from must be on or before to.");
  const sort = args.sort ?? "down_desc";
  if (!UPTIME_SORTS[sort]) throw new ToolError("bad_request", `sort must be one of ${Object.keys(UPTIME_SORTS).join(", ")}.`);
  const types = list(args.type, ENTITY_TYPES, "type") ?? new Set(["ATTRACTION"]);
  const limit = int(args.limit, { min: 1, max: 500, def: 25, name: "limit" });

  let res;
  try {
    res = await api(`/entity/${entity.id}/history/daily?from=${from}&to=${to}`);
  } catch (err) {
    if (err instanceof ToolError && err.code === "history_window_exceeded" && !apiKey()) {
      err.extra.hint = "Keyless history reaches back 7 days. A free THEMEPARKS_API_KEY extends it to 30.";
    }
    throw err;
  }
  const { data, fetchedAt, cached } = res;
  const head = {
    source: SOURCE,
    entity: entityHeader(entity),
    range: data?.range ?? { from, to },
    timezone: data?.timezone ?? tz,
    fetchedAt,
    cached,
    method: "uptimePct = operatingMinutes / (operatingMinutes + downMinutes), inside published park hours when the park published any. Unknown and CLOSED minutes are excluded. Today counts elapsed minutes only.",
  };
  if (Array.isArray(data?.entities)) {
    const rows = data.entities
      .filter((e) => types.has(e.entityType))
      .map((e) => ({ id: e.id, name: e.name, type: e.entityType, ...summarize((e.days ?? []).map(toDailyUptime)) }))
      .filter((r) => r.daysWithData > 0)
      .sort(UPTIME_SORTS[sort]);
    return { ...head, totalEntities: rows.length, returned: Math.min(limit, rows.length), entities: rows.slice(0, limit), next: data.next ?? null };
  }
  const daily = (data?.days ?? []).map(toDailyUptime);
  return { ...head, firstRecordedAt: data?.coverage?.firstRecordedAt ?? null, summary: summarize(daily), days: daily };
}

const TOOL_REGISTRY = {
  themeparks_find: {
    description:
      "Find theme park destinations, parks, rides, shows, restaurants, and hotels on ThemeParks.wiki by fuzzy name, across all resorts or inside one (within). No args lists all destinations with their parks. within + no query lists everything inside a resort or park.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Name to search, e.g. \"Universal Orlando\", \"Space Mountain\"." },
        within: WITHIN_ARG,
        type: { type: "string", description: `Filter by entity type, comma-separated: ${ENTITY_TYPES.join(", ")}.` },
        limit: { type: "integer", description: "Max matches (default 10 with query, 100 for a listing)." },
      },
    },
    handler: findTool,
  },
  themeparks_live: {
    description:
      "Live status and waits for a park, resort, or single ride/show: status OPERATING|DOWN|CLOSED|REFURBISHMENT, standby, single rider, paid standby, virtual queue and Lightning Lane return windows, boarding groups, lastUpdated. Filter by status, type, and wait range. Updates about once a minute.",
    inputSchema: {
      type: "object",
      required: ["entity"],
      properties: {
        entity: ENTITY_ARG,
        within: WITHIN_ARG,
        type: { type: "string", description: "Entity types to keep, comma-separated, e.g. ATTRACTION or ATTRACTION,SHOW." },
        status: { type: "string", description: `Statuses to keep, comma-separated: ${STATUSES.join(", ")}.` },
        min_wait: { type: "integer", description: "Keep items with standby wait >= this many minutes." },
        max_wait: { type: "integer", description: "Keep items with standby wait <= this many minutes." },
        sort: { type: "string", enum: Object.keys(SORTS), description: "Default wait_desc. Items without a wait sort last." },
        limit: { type: "integer", description: "Max items (default 30)." },
        include_forecast: { type: "boolean", description: "Include the park's hourly wait forecast when published. Default true for a single ride, false for a park." },
        include_times: { type: "boolean", description: "Include today's showtimes and operating hours. Default true for a single entity, false for a park." },
      },
    },
    handler: liveTool,
  },
  themeparks_schedule: {
    description:
      "Published opening hours for a park or resort over a date range, including early entry, extra hours, and ticketed events. Optional Lightning Lane / add-on prices. For a single ride or show with no schedule, returns today's live showtimes instead.",
    inputSchema: {
      type: "object",
      required: ["entity"],
      properties: {
        entity: ENTITY_ARG,
        within: WITHIN_ARG,
        from: { type: "string", description: "First date YYYY-MM-DD. Default today in the park's timezone." },
        days: { type: "integer", description: "Number of days (default 3, max 62)." },
        type: { type: "string", description: `Entry types to keep, comma-separated: ${SCHEDULE_TYPES.join(", ")}.` },
        include_purchases: { type: "boolean", description: "Include Lightning Lane / add-on purchase prices per day. Default false." },
      },
    },
    handler: scheduleTool,
  },
  themeparks_uptime: {
    description:
      "Ride uptime history from ThemeParks.wiki daily summaries: uptime %, minutes operating and down, first open and last close, and standby wait stats (p50/mean/p90/max) per day. For a park, ranks its rides by downtime. Keyless history covers the last 7 days.",
    inputSchema: {
      type: "object",
      required: ["entity"],
      properties: {
        entity: ENTITY_ARG,
        within: WITHIN_ARG,
        days: { type: "integer", description: "Days ending today (default 7). Keyless window is 7 days; a free key allows 30." },
        from: { type: "string", description: "Start date YYYY-MM-DD (overrides days)." },
        to: { type: "string", description: "End date YYYY-MM-DD (default today in the park's timezone)." },
        type: { type: "string", description: "For a park: entity types to rank, comma-separated. Default ATTRACTION." },
        sort: { type: "string", enum: Object.keys(UPTIME_SORTS), description: "For a park: default down_desc." },
        limit: { type: "integer", description: "For a park: max rides (default 25)." },
      },
    },
    handler: uptimeTool,
  },
};

function listTools() {
  return Object.entries(TOOL_REGISTRY).map(([name, t]) => ({ name, description: t.description, inputSchema: t.inputSchema }));
}

async function callTool(name, args) {
  const tool = TOOL_REGISTRY[name];
  if (!tool) return { isError: true, payload: { error: "unknown_tool", message: `Unknown tool ${name}.` } };
  try {
    return { isError: false, payload: await tool.handler(args ?? {}) };
  } catch (err) {
    if (err instanceof ToolError) return { isError: true, payload: { error: err.code, message: err.message, ...err.extra } };
    return { isError: true, payload: { error: "internal_error", message: err?.message || String(err) } };
  }
}

// ---------------------------------------------------------------------------
// stdio JSON-RPC (Content-Length or newline framing)
// ---------------------------------------------------------------------------

let framing = "content-length";

function send(msg) {
  const payload = Buffer.from(JSON.stringify(msg), "utf8");
  if (framing === "lf") {
    stdout.write(Buffer.concat([payload, Buffer.from("\n")]));
    return;
  }
  stdout.write(Buffer.concat([Buffer.from(`Content-Length: ${payload.length}\r\n\r\n`), payload]));
}

async function handle(msg) {
  if (!msg || typeof msg !== "object") return;
  const { id, method } = msg;
  if (id === undefined || id === null) return;
  const ok = (result) => send({ jsonrpc: "2.0", id, result });
  const fail = (code, message) => send({ jsonrpc: "2.0", id, error: { code, message } });
  try {
    switch (method) {
      case "initialize":
        ok({ protocolVersion: msg.params?.protocolVersion || PROTOCOL_VERSION, capabilities: { tools: { listChanged: false } }, serverInfo: SERVER_INFO });
        return;
      case "ping":
        ok({});
        return;
      case "tools/list":
        ok({ tools: listTools() });
        return;
      case "tools/call": {
        if (!msg.params?.name) return fail(-32602, "tools/call requires params.name");
        const { isError, payload } = await callTool(msg.params.name, msg.params.arguments);
        ok({ content: [{ type: "text", text: JSON.stringify(payload) }], isError });
        return;
      }
      default:
        fail(-32601, `Method not found: ${method}`);
    }
  } catch (err) {
    fail(-32603, err?.message || "Internal error");
  }
}

let buf = Buffer.alloc(0);

function dispatch(body) {
  let parsed;
  try {
    parsed = JSON.parse(body);
  } catch {
    send({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } });
    return;
  }
  void handle(parsed);
}

function pump() {
  while (buf.length) {
    if (/^Content-Length\s*:/i.test(buf.subarray(0, 32).toString("utf8"))) {
      const sep = buf.indexOf("\r\n\r\n");
      if (sep === -1) return;
      const len = Number(buf.subarray(0, sep).toString("utf8").match(/Content-Length:\s*(\d+)/i)?.[1]);
      const start = sep + 4;
      if (buf.length < start + len) return;
      framing = "content-length";
      const body = buf.subarray(start, start + len).toString("utf8");
      buf = buf.subarray(start + len);
      dispatch(body);
      continue;
    }
    const nl = buf.indexOf("\n");
    if (nl === -1) return;
    framing = "lf";
    const line = buf.subarray(0, nl).toString("utf8").replace(/\r$/, "");
    buf = buf.subarray(nl + 1);
    if (line.trim()) dispatch(line);
  }
}

function startedAsMain() {
  try {
    return Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href;
  } catch {
    return true;
  }
}

if (startedAsMain()) {
  stdin.on("data", (chunk) => {
    buf = Buffer.concat([buf, chunk]);
    pump();
  });
  stdin.on("end", () => pump());
  stdin.on("error", () => process.exit(1));
  if (stdin.isTTY) process.stderr.write("themeparks-web MCP expects stdio JSON-RPC\n");
  stdin.resume();
}

export { SERVER_INFO, TOOL_REGISTRY, QUEUE_FIELDS, listTools, callTool, normalize, score, rank, toLiveStatus, toDailyUptime, uptimePct };

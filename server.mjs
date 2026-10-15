#!/usr/bin/env node
/**
 * themeparks-web: zero-dependency stdio MCP over the ThemeParks.wiki v1 API.
 * Tools come from TOOL_REGISTRY. Queue kinds come from QUEUE_FIELDS.
 * Keyless by default. THEMEPARKS_API_KEY, when set, is sent as x-api-key.
 */
import { stdin, stdout } from "node:process";
import { pathToFileURL } from "node:url";

const VERSION = "0.1.4";
const PROTOCOL_VERSION = "2024-11-05";
const SERVER_INFO = { name: "themeparks-web", version: VERSION };
const API = "https://api.themeparks.wiki/v1";
const UA = `ThemeParksWebPlugin/${VERSION} (+https://github.com/TheAbsentTourist; chucktastictime@gmail.com)`;
const SOURCE = "ThemeParks.wiki (unofficial; data from park apps)";
const ATTRIBUTION = {
  text: "Powered by ThemeParks.wiki",
  url: "https://themeparks.wiki",
  markdown: "[Powered by ThemeParks.wiki](https://themeparks.wiki)",
  required: "ThemeParks.wiki's free use requires this credit. Include the markdown link in any answer built from this data.",
};
const KEY_SIGNUP_URL = "https://www.themeparks.wiki/register";
const KEY_CREATE_URL = "https://www.themeparks.wiki/profile";
const FORECAST_NOTE = "ThemeParks.wiki publishes wait forecasts only for Walt Disney World and Disneyland Resort parks.";
const TIMEOUT_MS = 20_000;
const LIVE_TTL_MS = 60_000;
const DEFAULT_TTL_MS = 300_000;
const CHILDREN_TTL_MS = 6 * 60 * 60_000;
const SCAN_CONCURRENCY = 4;
const STRONG_MATCH = 0.9;
const TIER_STOP = 0.8;
const MAJOR_RESORTS = /walt disney world|disneyland|tokyo disney|shanghai disney|hong kong disney|universal|seaworld|busch gardens|europa-park|efteling|cedar point|knott|legoland florida|six flags magic mountain|dollywood/i;
const STALE_AFTER_MINUTES = 24 * 60;
const DETAILS_MAX = 25;
const MATCH_THRESHOLD = 0.5;
const LIVE_STALE_GRACE_MS = 5 * 60_000;
const HISTORY_STALE_GRACE_MS = 30 * 60_000;
const DEFAULT_STALE_GRACE_MS = 15 * 60_000;
const CHILDREN_STALE_GRACE_MS = 60 * 60_000;
const REQUESTS_PER_MINUTE = 300;
const PARK_DAILY_PAGE_DAYS = 31;
const API_HOST = "api.themeparks.wiki";
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
  if (!key || /^\$\{.*\}$/.test(key)) return "";
  if (/[\r\n\0]/.test(key)) {
    throw new ToolError("bad_request", "THEMEPARKS_API_KEY contains a character that cannot be sent in a header. Leave it unset to stay keyless.");
  }
  return key;
}

// ---------------------------------------------------------------------------
// HTTP boundary: cache, 429, upstream error shapes
// ---------------------------------------------------------------------------

const cache = new Map();
const inflight = new Map();
const requestStamps = [];

function ttlFor(path) {
  if (path === "/me") return 0;
  if (/\/live(\?|$)/.test(path)) return LIVE_TTL_MS;
  if (path.endsWith("/children")) return CHILDREN_TTL_MS;
  return DEFAULT_TTL_MS;
}

function graceFor(path) {
  if (/\/live(\?|$)/.test(path)) return LIVE_STALE_GRACE_MS;
  if (path.includes("/history")) return HISTORY_STALE_GRACE_MS;
  if (path.endsWith("/children")) return CHILDREN_STALE_GRACE_MS;
  return DEFAULT_STALE_GRACE_MS;
}

function readCache(path) {
  const hit = cache.get(path);
  if (!hit) return null;
  const age = Date.now() - hit.at;
  if (age > ttlFor(path) + graceFor(path)) {
    cache.delete(path);
    return null;
  }
  return { hit, fresh: age < ttlFor(path) };
}

function remember(path, at, data) {
  if (path === "/me") return;
  cache.set(path, { at, data });
  if (cache.size <= 400) return;
  const now = Date.now();
  for (const [k, v] of cache) if (now - v.at > ttlFor(k) + graceFor(k)) cache.delete(k);
}

function requestBudget() {
  const rl = meMemo?.plan?.rateLimit;
  if (rl?.unmetered) return null;
  const limit = Number(rl?.limit);
  const windowSeconds = Number(rl?.windowSeconds);
  if (Number.isFinite(limit) && limit > 0) return { limit, windowMs: (Number.isFinite(windowSeconds) && windowSeconds > 0 ? windowSeconds : 60) * 1000 };
  return { limit: REQUESTS_PER_MINUTE, windowMs: 60_000 };
}

function takeRequestSlot() {
  const budget = requestBudget();
  if (!budget) return;
  const now = Date.now();
  const start = now - budget.windowMs;
  while (requestStamps.length && requestStamps[0] <= start) requestStamps.shift();
  if (requestStamps.length >= budget.limit) {
    const retryAfterSeconds = Math.max(1, Math.ceil((requestStamps[0] + budget.windowMs - now) / 1000));
    throw new ToolError("rate_limited", `Local request budget reached (${budget.limit} per ${Math.round(budget.windowMs / 1000)}s). Retry in ${retryAfterSeconds}s.`, { retryAfterSeconds });
  }
  requestStamps.push(now);
}

function retryAfterSecondsFrom(body, headers) {
  const nested = typeof body?.error === "object" && body?.error ? body.error.retryAfter : undefined;
  const raw = body?.retryAfter ?? nested ?? headers?.get?.("retry-after");
  if (raw == null || raw === "") return 60;
  const n = Number(raw);
  if (Number.isFinite(n)) return Math.max(1, Math.round(n));
  const when = Date.parse(String(raw));
  if (Number.isFinite(when)) return Math.max(1, Math.round((when - Date.now()) / 1000));
  return 60;
}

async function api(path) {
  const cached = readCache(path);
  if (cached?.fresh) return { data: cached.hit.data, fetchedAt: new Date(cached.hit.at).toISOString(), cached: true };
  if (inflight.has(path)) return inflight.get(path);
  const p = fetchFresh(path, cached?.hit ?? null).finally(() => inflight.delete(path));
  inflight.set(path, p);
  return p;
}

function staleFrom(hit, reason) {
  return { data: hit.data, fetchedAt: new Date(hit.at).toISOString(), cached: true, staleBecause: reason };
}

async function fetchSameOrigin(path, headers) {
  let url = API + path;
  for (let hop = 0; hop < 3; hop++) {
    const res = await fetch(url, { headers, redirect: "manual", signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (res.status < 300 || res.status >= 400) return res;
    const loc = res.headers.get("location");
    if (!loc) throw new ToolError("upstream_error", "ThemeParks.wiki redirected without a Location header.");
    let next;
    try {
      next = new URL(loc, url);
    } catch {
      throw new ToolError("upstream_error", "ThemeParks.wiki sent a redirect that could not be parsed.");
    }
    if (next.protocol !== "https:" || next.host !== API_HOST) {
      throw new ToolError("upstream_error", "Refused a redirect off api.themeparks.wiki.");
    }
    url = next.href;
  }
  throw new ToolError("upstream_error", "ThemeParks.wiki redirected too many times.");
}

async function fetchFresh(path, hit) {
  try {
    takeRequestSlot();
  } catch (err) {
    if (hit && err instanceof ToolError && err.code === "rate_limited") return { ...staleFrom(hit, "rate_limited"), retryAfterSeconds: err.extra?.retryAfterSeconds };
    throw err;
  }
  const headers = { Accept: "application/json", "User-Agent": UA };
  const key = apiKey();
  if (key) headers["x-api-key"] = key;
  let res;
  try {
    res = await fetchSameOrigin(path, headers);
  } catch (err) {
    if (err instanceof ToolError) {
      if (hit) return staleFrom(hit, err.code === "rate_limited" ? "rate_limited" : "upstream_error");
      throw err;
    }
    if (hit) return staleFrom(hit, "network_error");
    throw new ToolError("network_error", `Could not reach ThemeParks.wiki: ${err?.message || err}`);
  }
  const body = await res.json().catch(() => null);
  const historyBudget = budgetFrom(res.headers);
  if (historyBudget) lastHistoryBudget = { ...historyBudget, seenAt: new Date().toISOString() };
  if (res.status === 429) {
    const retryAfterSeconds = retryAfterSecondsFrom(body, res.headers);
    if (hit) return staleFrom(hit, "rate_limited");
    throw new ToolError("rate_limited", `ThemeParks.wiki rate limit reached. Retry in ${retryAfterSeconds}s.`, {
      retryAfterSeconds,
      historyBudget: historyBudget ?? undefined,
      hint: apiKey() ? undefined : "A free THEMEPARKS_API_KEY raises the history budget from 60 to 600 calls per hour.",
    });
  }
  if ([502, 503, 504].includes(res.status)) {
    const message = (typeof body?.error === "object" && body?.error?.message) || body?.message || `HTTP ${res.status}`;
    if (hit) return staleFrom(hit, "upstream_error");
    throw new ToolError("upstream_error", message, { status: res.status });
  }
  if (!res.ok) {
    const e = body?.error;
    const type = typeof e === "object" && e ? e.type : e;
    const message = (typeof e === "object" && e?.message) || body?.message || `HTTP ${res.status}`;
    const code = res.status === 404
      ? "not_found"
      : res.status === 401
      ? "unauthorized"
      : type === "HISTORY_WINDOW_EXCEEDED"
      ? "history_window_exceeded"
      : "upstream_error";
    throw new ToolError(code, message, {
      status: res.status,
      upstreamType: type || undefined,
      earliestAllowedDate: e?.earliestAllowedDate,
    });
  }
  const at = Date.now();
  remember(path, at, body);
  return { data: body, fetchedAt: new Date(at).toISOString(), cached: false, historyBudget };
}

// RateLimit-History-* headers (sent when a history budget is metered for this caller). Values only, never the key.
let lastHistoryBudget = null;
function budgetFrom(headers) {
  const get = (n) => headers?.get?.(n);
  const limit = get("ratelimit-history-limit");
  const remaining = get("ratelimit-history-remaining");
  const reset = get("ratelimit-history-reset");
  if (limit == null && remaining == null) return null;
  return {
    limit: limit == null ? null : Number(limit),
    remaining: remaining == null ? null : Number(remaining),
    resetSeconds: reset == null ? null : Number(reset),
    policy: get("ratelimit-history-policy") ?? undefined,
  };
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
  // Tiers: exact name/slug (1) > same words ignoring "park"/"resort" (0.97) > every word prefix-matched (0.8-0.95) > substring (0.7) > partial.
  if (q === normalize(ref.name) || q === normalize(ref.slug)) return 1;
  const qt = tokens(query);
  const ct = tokens(ref.name);
  const resortish = ref.type === "DESTINATION" && RESORTISH.test(q) ? 0.02 : 0;
  if (qt.join(" ") === ct.join(" ")) return 0.97 + resortish;
  const has = (t) => ct.some((c) => c === t || (t.length >= 3 && c.startsWith(t)));
  const hits = qt.filter(has).length;
  if (hits === qt.length) return 0.8 + 0.15 * (qt.length / Math.max(ct.length, qt.length)) + resortish;
  if (normalize(ref.name).includes(q)) return 0.7;
  return 0.6 * (hits / qt.length);
}

const RESORTISH = /\b(resort|resorts|world|destination)\b/;

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
    refs.push({ id: d.id, name: d.name, type: "DESTINATION", slug: d.slug ?? null, externalId: d.externalId ?? null });
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
    park: c.entityType === "PARK" ? c.name : c.entityType === "DESTINATION" ? undefined : parks.get(c.parentId) ?? (c.parentId === parent.id && parent.type === "PARK" ? parent.name : undefined),
    destination: parent.type === "DESTINATION" ? parent.name : parent.destination,
  }));
}

async function searchEverywhere(query, keep = () => true) {
  const destinations = (await catalog()).filter((r) => r.type === "DESTINATION");
  const tiers = [destinations.filter((d) => MAJOR_RESORTS.test(d.name)), destinations.filter((d) => !MAJOR_RESORTS.test(d.name))];
  const hits = [];
  let scanned = 0;
  let stoppedBy = null;
  let stopError = null;
  const noteStop = (err) => {
    if (stoppedBy) return;
    if (err instanceof ToolError) {
      stoppedBy = err.code;
      stopError = err;
      return;
    }
    stoppedBy = "network_error";
    stopError = new ToolError("network_error", `Could not reach ThemeParks.wiki: ${err?.message || err}`);
  };
  for (const tier of tiers) {
    const queue = [...tier];
    const worker = async () => {
      while (queue.length && !stoppedBy) {
        const d = queue.shift();
        if (!d) return;
        try {
          for (const ref of await childrenOf(d)) {
            if (keep(ref)) hits.push({ ref: { ...ref, destination: d.name }, score: Math.round(score(query, ref) * 100) / 100 });
          }
          scanned++;
        } catch (err) {
          noteStop(err);
        }
      }
    };
    await Promise.all(Array.from({ length: SCAN_CONCURRENCY }, worker));
    if (stoppedBy || hits.some((h) => h.score >= TIER_STOP)) break;
  }
  const ranked = hits.filter((h) => h.score >= MATCH_THRESHOLD).sort((a, b) => b.score - a.score || a.ref.name.localeCompare(b.ref.name));
  const scan = {
    destinationsScanned: scanned,
    destinationsTotal: destinations.length,
    stoppedBy: stoppedBy ?? undefined,
    retryAfterSeconds: stopError?.extra?.retryAfterSeconds,
  };
  return { ranked, scan, stopError };
}

async function rankAnywhere(query, keep = () => true) {
  const local = rank(query, (await catalog()).filter(keep));
  if (local[0]?.score >= STRONG_MATCH) return { ranked: local };
  const { ranked, scan, stopError } = await searchEverywhere(query, keep);
  const merged = [...ranked, ...local].sort((a, b) => b.score - a.score || a.ref.name.localeCompare(b.ref.name));
  if (stopError && stopError.code !== "rate_limited") {
    stopError.extra = { ...stopError.extra, scan, candidates: merged.slice(0, 8).map(entityOut) };
    if (scan.destinationsScanned === 0 || !merged.length || merged[0].score < STRONG_MATCH) throw stopError;
  }
  return { ranked: merged, scan };
}

const CORE_KEYS = new Set(["id", "name", "slug", "parkId", "parentId", "timezone", "entityType", "destinationId", "externalId", "attractionType", "location", "_id"]);

// Ride attributes. ThemeParks.wiki spreads tags into the entity document, so keys vary by park.
function rideDetails(data) {
  const extra = Object.fromEntries(Object.entries(data ?? {}).filter(([k, v]) => !CORE_KEYS.has(k) && v !== null && typeof v !== "object"));
  const out = {
    attractionType: data?.attractionType ?? null,
    minimumHeight: data?.minimumHeight ?? null,
    maximumHeight: data?.maximumHeight ?? null,
    heightUnit: data?.minimumHeight != null || data?.maximumHeight != null ? "cm" : undefined,
    mayGetWet: data?.mayGetWet ?? null,
    location: data?.location ? { latitude: data.location.latitude, longitude: data.location.longitude } : null,
  };
  for (const [k, v] of Object.entries(extra)) if (!(k in out)) out[k] = v;
  return out;
}

async function entityDetails(id) {
  const [{ data }, refs] = await Promise.all([api(`/entity/${encodeURIComponent(id)}`), catalog()]);
  const byId = new Map(refs.map((r) => [r.id, r]));
  const parkId = data.entityType === "PARK" ? null : data.parkId ?? (byId.get(data.parentId)?.type === "PARK" ? data.parentId : null);
  const destination = data.entityType === "DESTINATION" ? undefined : byId.get(data.destinationId)?.name ?? byId.get(parkId)?.destination;
  return {
    id: data.id,
    name: data.name,
    type: data.entityType,
    slug: data.slug ?? null,
    timezone: data.timezone ?? null,
    parentId: data.parentId ?? null,
    destinationId: data.destinationId ?? null,
    park: parkId ? byId.get(parkId)?.name : undefined,
    destination,
    details: ["ATTRACTION", "SHOW", "RESTAURANT"].includes(data.entityType) ? rideDetails(data) : undefined,
  };
}

// Operator ids and slugs resolve in one call, never a scan.
async function resolveDirect(text) {
  const exact = (await catalog()).find((r) => r.slug === text || r.externalId === text);
  if (exact) return entityDetails(exact.id);
  if (/\s/.test(text) || !/[-_;=.\d]/.test(text)) return null;
  try {
    return await entityDetails(text);
  } catch (err) {
    if (err instanceof ToolError && err.code === "not_found") return null;
    throw err;
  }
}

async function resolve(ref, within) {
  const text = typeof ref === "string" ? ref.trim() : "";
  if (!text) throw new ToolError("bad_request", "entity is required (a name like \"Magic Kingdom\" or a ThemeParks.wiki id).");
  if (UUID.test(text)) return entityDetails(text);
  if (!within) {
    const direct = await resolveDirect(text);
    if (direct) return direct;
    // Operator ids (";", "=") fail fast. Hyphenated names fall through to fuzzy search after a 404.
    if (/[;=]/.test(text)) {
      throw new ToolError("not_found", `No ThemeParks.wiki entity has the id, slug, or destination externalId "${text}".`, {
        hint: "Upstream resolves UUIDs, slugs, and destination externalIds directly; ride-level operator ids are not indexed. Search by name instead.",
      });
    }
  }
  const parent = within ? await resolve(within) : null;
  const { ranked, scan } = parent ? { ranked: rank(text, await childrenOf(parent)) } : await rankAnywhere(text);
  if (!ranked.length) {
    throw new ToolError("not_found", `Nothing ${parent ? `in ${parent.name} ` : ""}matches "${text}".`, {
      scan,
      retryAfterSeconds: scan?.retryAfterSeconds,
      hint: scan?.stoppedBy === "rate_limited"
        ? `The all-resort search stopped at the rate limit${scan.retryAfterSeconds ? ` (retry in ${scan.retryAfterSeconds}s)` : ""}. Retry shortly or pass within=<park or resort>.`
        : scan?.stoppedBy
        ? `The all-resort search stopped (${scan.stoppedBy}). Retry shortly or pass within=<park or resort>.`
        : "Try a shorter query or pass within=<park or resort>.",
    });
  }
  const [top, second] = ranked;
  const tied = top.score === 1 ? second?.score === 1 : top.score - (second?.score ?? 0) < 0.02;
  if (second && top.score >= 0.9 && tied && top.ref.id !== second.ref.id) {
    throw new ToolError("ambiguous", `"${text}" matches several entities. Pass one id, or narrow with within.`, {
      candidates: ranked.slice(0, 8).map(entityOut),
    });
  }
  const found = await entityDetails(top.ref.id);
  return { ...found, park: found.park ?? top.ref.park, destination: found.destination ?? top.ref.destination, matchScore: top.score };
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

// Today's lowest predicted wait window from the hourly forecast (WDW and Disneyland Resort only).
function bestTimeToRide(forecast, tz, now) {
  if (!forecast?.length) return { available: false, reason: FORECAST_NOTE };
  const today = todayIn(tz, now);
  const hourStart = startOfLocalHour(now, tz || "UTC");
  const slots = forecast
    .filter((f) => f.waitTime != null && todayIn(tz, Date.parse(f.time)) === today && Date.parse(f.time) >= hourStart)
    .sort((a, b) => Date.parse(a.time) - Date.parse(b.time));
  if (!slots.length) return { available: false, reason: "No forecast hours left today." };
  const low = Math.min(...slots.map((f) => f.waitTime));
  let best = null;
  for (let i = 0; i < slots.length; i++) {
    if (slots[i].waitTime !== low) continue;
    let j = i;
    while (j + 1 < slots.length && slots[j + 1].waitTime === low && Date.parse(slots[j + 1].time) - Date.parse(slots[j].time) === 3_600_000) j++;
    if (!best || j - i > best.j - best.i) best = { i, j };
    i = j;
  }
  const start = slots[best.i];
  const endMs = Date.parse(slots[best.j].time) + 3_600_000;
  return {
    available: true,
    start: start.time,
    end: localTime(endMs, tz).iso,
    startLocal: localTime(Date.parse(start.time), tz).text,
    endLocal: localTime(endMs, tz).text,
    predictedWait: low,
    percentage: start.percentage ?? null,
    hoursConsidered: slots.length,
    basis: "Lowest predicted standby wait in today's remaining forecast hours. percentage is ThemeParks.wiki's crowd index for that hour.",
  };
}

function toLiveStatus(raw, { parks, now, includeForecast, includeTimes, tz }) {
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
  if (includeForecast) {
    if (raw.forecast?.length) out.forecast = raw.forecast.map(({ time, waitTime, percentage }) => ({ time, waitTime, percentage: percentage ?? undefined }));
    if (raw.entityType === "ATTRACTION") out.bestTimeToRide = bestTimeToRide(raw.forecast, tz || "UTC", now);
  }
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
  const s = String(v);
  if (!YMD.test(s)) throw new ToolError("bad_request", `${name} must be YYYY-MM-DD.`);
  const [y, m, d] = s.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) {
    throw new ToolError("bad_request", `${name} must be a real calendar date (YYYY-MM-DD).`);
  }
  return s;
}

function todayIn(tz, at = Date.now()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz || "UTC", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(at));
}

function zonedParts(tz, at) {
  const date = new Date(at);
  if (Number.isNaN(date.getTime())) throw new ToolError("bad_request", "Invalid time value.");
  try {
    return Object.fromEntries(
      new Intl.DateTimeFormat("en-US", { timeZone: tz || "UTC", hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })
        .formatToParts(date)
        .map((x) => [x.type, x.value]),
    );
  } catch {
    throw new ToolError("bad_request", `Unknown timezone "${tz}".`);
  }
}

function tzOffsetMinutes(tz, at) {
  const parts = zonedParts(tz, at);
  const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
  return Math.round((asUtc - Math.floor(at / 1000) * 1000) / 60_000);
}

function startOfLocalHour(now, tz, depth = 0) {
  if (depth > 4) return now - (now % 3_600_000);
  const p = zonedParts(tz, now);
  const wall = `${p.year}-${p.month}-${p.day}T${p.hour}:00:00`;
  try {
    return localToInstant(wall, tz).ms;
  } catch {
    return startOfLocalHour(now + 30 * 60_000, tz, depth + 1);
  }
}

function fmtOffset(min) {
  const sign = min < 0 ? "-" : "+";
  const a = Math.abs(min);
  return `${sign}${String(Math.floor(a / 60)).padStart(2, "0")}:${String(a % 60).padStart(2, "0")}`;
}

function wallClock(wall) {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(String(wall));
  if (!m) throw new ToolError("bad_request", "Time must look like 2026-10-11T16:00.");
  const hour = Number(m[2]);
  const minute = Number(m[3]);
  const second = m[4] === undefined ? 0 : Number(m[4]);
  if (hour > 23 || minute > 59 || second > 59) {
    throw new ToolError("bad_request", `${wall} is not a real clock time (hour 00-23, minute and second 00-59).`);
  }
  ymd(m[1], "date");
  return `${m[1]}T${m[2]}:${m[3]}:${String(second).padStart(2, "0")}`;
}

// A park-local wall time ("2026-10-11T16:00") as an instant with the park's offset.
// A daylight-saving gap does not round-trip and is rejected. A repeated hour is kept, with ambiguousNote naming the offset used.
function localToInstant(wall, tz) {
  const wanted = wallClock(wall);
  const guess = Date.parse(`${wanted}Z`);
  if (!Number.isFinite(guess)) throw new ToolError("bad_request", `${wall} is not a real timestamp.`);
  let off = tzOffsetMinutes(tz, guess);
  off = tzOffsetMinutes(tz, guess - off * 60_000);
  const ms = guess - off * 60_000;
  const back = localTime(ms, tz);
  if (back.iso.slice(0, 19) !== wanted) {
    const next = timeAfterGap(ms, tz, wanted, back);
    throw new ToolError("bad_request", `${wanted} does not exist in ${tz} (the clock skips that time). The next valid park time is ${next.text}.`);
  }
  const iso = `${wanted}${fmtOffset(off)}`;
  let ambiguousNote;
  for (const deltaMin of [30, 60, 90, 120]) {
    for (const sign of [1, -1]) {
      let alt;
      try {
        alt = localTime(ms + sign * deltaMin * 60_000, tz);
      } catch {
        continue;
      }
      if (alt.iso.slice(0, 19) === wanted && alt.iso !== iso) {
        ambiguousNote = `${wanted} occurs twice in ${tz}. Used offset ${fmtOffset(off)} (${back.text}).`;
        break;
      }
    }
    if (ambiguousNote) break;
  }
  return { ms, iso, ambiguousNote };
}

// When a wall time falls in a daylight-saving gap, name the same clock position after the jump (2:30 AM skipped -> 3:30 AM).
function timeAfterGap(ms, tz, wanted, back) {
  const step = 60_000;
  const from = Math.floor((ms - 3 * 3_600_000) / step) * step;
  const to = ms + 3 * 3_600_000;
  let prev = tzOffsetMinutes(tz, from);
  for (let t = from + step; t <= to; t += step) {
    const off = tzOffsetMinutes(tz, t);
    const deltaMin = off - prev;
    if (deltaMin > 0) {
      const before = localTime(t - step, tz);
      const into = Date.parse(`${wanted}Z`) - (Date.parse(`${before.iso.slice(0, 19)}Z`) + step);
      return localTime(t + into, tz);
    }
    prev = off;
  }
  return back;
}

function localTime(ms, tz) {
  const off = tzOffsetMinutes(tz, ms);
  const iso = new Date(Math.floor(ms / 1000) * 1000 + off * 60_000).toISOString().slice(0, 19) + fmtOffset(off);
  const text = new Intl.DateTimeFormat("en-US", { timeZone: tz, month: "short", day: "numeric", hour: "numeric", minute: "2-digit", second: "2-digit", timeZoneName: "short" }).format(new Date(ms));
  return { iso, text };
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
  const mode = args.mode ?? "search";
  if (mode === "key_status") return { source: SOURCE, mode, ...(await keyStatus()) };
  if (mode !== "search") throw new ToolError("bad_request", "mode must be search or key_status.");
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
    : pool.map((ref) => ({ id: ref.id, name: ref.name, type: ref.type, park: ref.park, destination: ref.destination, slug: ref.slug ?? undefined })).sort((a, b) => a.name.localeCompare(b.name));
  const shown = matches.slice(0, limit);
  if (args.include_details) {
    const n = Math.min(shown.length, DETAILS_MAX);
    await Promise.all(
      shown.slice(0, n).map(async (m) => {
        if (["ATTRACTION", "SHOW", "RESTAURANT"].includes(m.type)) m.details = (await entityDetails(m.id).catch(() => ({}))).details;
      }),
    );
  }
  return {
    source: SOURCE,
    within: parent ? entityHeader(parent) : undefined,
    query: query || undefined,
    scan: global?.scan,
    totalMatched: matches.length,
    detailsFor: args.include_details ? Math.min(shown.length, DETAILS_MAX) : undefined,
    matches: shown,
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
  const mode = args.mode ?? "snapshot";
  if (!["snapshot", "watch"].includes(mode)) throw new ToolError("bad_request", "mode must be snapshot or watch.");
  if (mode === "watch") {
    const entity = await resolve(args.entity, args.within);
    return { source: SOURCE, entity: entityHeader(entity), ...(await watchTool(entity, args, entity.timezone || "UTC", await parkNames())) };
  }
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
  // Each item keeps its own park's timezone (a same-name group can span Florida and California).
  const rawItems = sameName
    ? responses.flatMap((r, k) => (r.data?.liveData ?? []).filter((x) => x.id === ids[k]).map((raw) => ({ raw, tz: r.data?.timezone })))
    : (data?.liveData ?? []).map((raw) => ({ raw, tz: data?.timezone ?? entity?.timezone }));
  const now = Date.now();
  const all = rawItems
    .filter(({ raw }) => !types || types.has(raw.entityType))
    .map(({ raw, tz }) => ({ ...toLiveStatus(raw, { parks, now, includeForecast, includeTimes, tz }), timezone: sameName ? tz : undefined }));
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
      : { ...entityHeader(entity), timezone: data?.timezone ?? entity.timezone ?? undefined, details: args.include_details === false ? undefined : entity.details },
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
  const parkList = [];
  const seenParks = new Set();
  const rows = responses.flatMap(({ data }) => [
    ...(data?.schedule ?? []).map((s) => ({ s, park: undefined })),
    ...(data?.parks ?? []).flatMap((pk) => {
      if (pk?.id && !seenParks.has(pk.id)) {
        seenParks.add(pk.id);
        parkList.push({ id: pk.id, name: pk.name ?? null });
      }
      return (pk.schedule ?? []).map((s) => ({ s, park: pk.name }));
    }),
  ]);
  parkList.sort((a, b) => String(a.name).localeCompare(String(b.name)));
  {
    for (const { s, park } of rows) {
      if (s.date < from || s.date > to || (types && !types.has(s.type))) continue;
      const entry = { park, type: s.type, open: s.openingTime, close: s.closingTime, description: s.description };
      if (includePurchases && s.purchases?.length) {
        entry.purchases = s.purchases.map((p) => ({ name: p.name, type: p.type, price: p.price?.formatted ?? null, available: p.available ?? null }));
      }
      if (!byDate.has(s.date)) byDate.set(s.date, []);
      byDate.get(s.date).push(entry);
    }
  }
  const scheduleDays = [...byDate.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, entries]) => ({ date, entries: entries.sort((a, b) => String(a.park ?? "").localeCompare(String(b.park ?? "")) || String(a.open).localeCompare(String(b.open))) }));
  const out = {
    source: SOURCE,
    entity: entityHeader(entity),
    range: { from, to, timezone: tz },
    fetchedAt: responses[0]?.fetchedAt,
    ...(entity.type === "DESTINATION" ? { parks: parkList } : {}),
    days: scheduleDays,
  };
  const missing = Array.from({ length: days }, (_, i) => addDays(from, i)).filter((d) => !byDate.has(d));
  if (missing.length) out.datesWithoutPublishedHours = missing;
  if (!scheduleDays.length && !["PARK", "DESTINATION"].includes(entity.type)) {
    const live = await api(`/entity/${entity.id}/live`);
    const raw = live.data?.liveData?.find((r) => r.id === entity.id);
    out.note = "No published schedule for this entity. Today's times from live data are shown instead.";
    out.todayFromLive = raw
      ? toLiveStatus(raw, { parks: await parkNames(), now: Date.now(), includeForecast: false, includeTimes: true, tz })
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

// Plan: what the key (or no key) unlocks. One /v1/me read, cached 10 min.
const KEYLESS_PLAN = { keyConfigured: false, tier: "keyless", historyDays: 7, historyAllArchive: false, historyEarliestDate: null, historyCallsPerHour: 60, source: "keyless defaults" };
const ME_TTL_MS = 10 * 60_000;
const DAILY_MAX_DAYS = 3660;
const RAW_ENTITY_MAX_DAYS = 31;
const PARK_DAILY_MAX_PAGES = 15;
let meMemo = null;

async function plan() {
  if (!apiKey()) return KEYLESS_PLAN;
  if (meMemo && Date.now() - meMemo.at < ME_TTL_MS) return meMemo.plan;
  try {
    const { data } = await api("/me");
    const p = {
      keyConfigured: true,
      tier: data?.tier ?? "unknown",
      historyDays: data?.historyAllArchive ? null : data?.historyDays ?? null,
      historyAllArchive: Boolean(data?.historyAllArchive),
      historyEarliestDate: data?.historyEarliestDate ?? null,
      historyCallsPerHour: data?.historyRateLimit?.unmetered ? null : data?.historyRateLimit?.limit ?? null,
      rateLimit: data?.rateLimit ?? null,
      historyRateLimit: data?.historyRateLimit ?? null,
      source: "/v1/me",
    };
    meMemo = { at: Date.now(), plan: p };
    return p;
  } catch (err) {
    return { ...KEYLESS_PLAN, keyConfigured: true, tier: "unknown", historyDays: 30, source: "fallback", planError: err instanceof ToolError ? `${err.code}: ${err.message}` : String(err) };
  }
}

function windowDays(p) {
  return p.historyAllArchive ? DAILY_MAX_DAYS : Math.min(DAILY_MAX_DAYS, p.historyDays ?? 7);
}

function windowHint(p) {
  return p.keyConfigured
    ? `Your ${p.tier} plan reaches back ${p.historyAllArchive ? "to the full archive" : `${p.historyDays} days`}${p.historyEarliestDate ? ` (earliest ${p.historyEarliestDate})` : ""}.`
    : `Keyless history reaches back 7 days at 60 history calls per hour. An optional free THEMEPARKS_API_KEY (${KEY_SIGNUP_URL}) extends it to 30 days and 600 calls per hour.`;
}

async function keyStatus() {
  if (!apiKey()) {
    return {
      keyConfigured: false,
      message: "No THEMEPARKS_API_KEY is set. Everything works keyless: live, schedules, and 7 days of history at 60 history calls per hour. A key is optional.",
      plan: KEYLESS_PLAN,
      getAKey: { signup: KEY_SIGNUP_URL, createKey: KEY_CREATE_URL, steps: "Create a free account, then generate a key on your profile page and set THEMEPARKS_API_KEY." },
      lastHistoryBudget: lastHistoryBudget ?? undefined,
    };
  }
  meMemo = null;
  const p = await plan();
  if (p.source === "fallback") {
    return { keyConfigured: true, valid: false, message: `THEMEPARKS_API_KEY is set but /v1/me failed (${p.planError}). Check the key at ${KEY_CREATE_URL}.` };
  }
  return { keyConfigured: true, valid: true, message: `Key accepted. Plan: ${p.tier}. ${windowHint(p)}`, plan: p, lastHistoryBudget: lastHistoryBudget ?? undefined };
}

// Minute-level history: status intervals, wait timeline, opening freshness
const WALL = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/;
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

function instantArg(v, tz, name) {
  const t = String(v).trim();
  if (INSTANT.test(t)) {
    const ms = Date.parse(t);
    if (!Number.isFinite(ms)) throw new ToolError("bad_request", `${name} must be a real timestamp. Got "${t}".`);
    return { ms, iso: t };
  }
  if (WALL.test(t)) return localToInstant(t, tz);
  throw new ToolError("bad_request", `${name} must be a park-local time like 2026-10-11T16:00, an RFC 3339 instant with an offset, or (for a whole day) YYYY-MM-DD.`);
}

function standbyOf(row) {
  return row?.queue?.STANDBY ? row.queue.STANDBY.waitTime ?? null : undefined;
}

function freshness(opening, tz) {
  if (!opening) return null;
  const start = Date.parse(opening.time);
  const seen = opening.observedAt ? Date.parse(opening.observedAt) : null;
  return {
    status: opening.status ?? null,
    standbyWait: standbyOf(opening) ?? null,
    observedAt: opening.observedAt ?? null,
    observedAtLocal: seen ? localTime(seen, tz).text : null,
    carriedInMinutes: seen !== null ? Math.round((start - seen) / 60_000) : null,
    staleCarryIn: seen !== null && start - seen > STALE_AFTER_MINUTES * 60_000 ? true : undefined,
    degraded: opening.degraded ? true : undefined,
    degradedReason: opening.degradedReason ?? undefined,
    note: opening.degraded
      ? "ThemeParks.wiki could not look far enough back; the opening state may be incomplete. Ask again in a minute."
      : seen === null
      ? "No reading before this range; the opening state is unknown."
      : undefined,
  };
}

function timeline(opening, rows, startMs, endMs, tz) {
  const events = [{ time: startMs, status: opening?.status ?? null, wait: standbyOf(opening) }]
    .concat(rows.map((r) => ({ time: Date.parse(r.time), status: r.status ?? null, wait: standbyOf(r) })))
    .filter((e) => e.time <= endMs);
  const intervals = [];
  for (const e of events) {
    const last = intervals.at(-1);
    if (last && last.status === e.status) continue;
    if (last) last.endMs = e.time;
    intervals.push({ status: e.status, startMs: e.time, endMs });
  }
  const spans = intervals.map((iv) => ({
    status: iv.status ?? "UNKNOWN",
    start: localTime(iv.startMs, tz).iso,
    end: localTime(iv.endMs, tz).iso,
    startLocal: localTime(iv.startMs, tz).text,
    endLocal: localTime(iv.endMs, tz).text,
    minutes: Math.round((iv.endMs - iv.startMs) / 60_000),
    openEnded: iv.endMs === endMs ? true : undefined,
  }));
  const minutesBy = {};
  for (const s of spans) minutesBy[s.status] = (minutesBy[s.status] ?? 0) + s.minutes;
  // A null wait (ride down or closed) ends the previous wait segment.
  const segs = [];
  for (const e of events) {
    if (e.wait === undefined) continue;
    if (segs.length && segs.at(-1).wait === e.wait) continue;
    segs.push({ wait: e.wait, ms: e.time });
  }
  let weighted = 0;
  let span = 0;
  segs.forEach((g, i) => {
    if (g.wait === null) return;
    const until = i + 1 < segs.length ? segs[i + 1].ms : endMs;
    weighted += g.wait * (until - g.ms);
    span += until - g.ms;
  });
  const waits = segs.filter((g) => g.wait !== null).map((g) => {
    const lt = localTime(g.ms, tz);
    return { time: lt.iso, timeLocal: lt.text, wait: g.wait, ms: g.ms };
  });
  const values = waits.map((w) => w.wait);
  const peak = waits.reduce((m, w) => (!m || w.wait > m.wait ? w : m), null);
  const low = waits.reduce((m, w) => (!m || w.wait < m.wait ? w : m), null);
  return {
    intervals: spans,
    minutesByStatus: minutesBy,
    waitTimeline: values.length
      ? {
          points: waits.length,
          min: Math.min(...values),
          max: Math.max(...values),
          timeWeightedMean: span ? Math.round(weighted / span) : null,
          first: values[0],
          last: values.at(-1),
          peakAt: peak?.timeLocal,
          lowAt: low?.timeLocal,
          changes: waits.map(({ time, timeLocal, wait }) => ({ time, timeLocal, wait })),
        }
      : null,
  };
}

async function historyCall(path, p) {
  try {
    return await api(path);
  } catch (err) {
    if (err instanceof ToolError && ["history_window_exceeded", "rate_limited"].includes(err.code)) err.extra.hint = windowHint(p);
    throw err;
  }
}

function budgetReport(res, p) {
  const b = res.historyBudget ?? null;
  return {
    historyBudget: b ?? undefined,
    historyBudgetNote: b
      ? undefined
      : res.cached
      ? "Served from cache; no history budget spent."
      : p.keyConfigured
      ? "No RateLimit-History headers on this response. themeparks_find mode=key_status reports the exact remaining budget."
      : "ThemeParks.wiki sends no RateLimit-History headers on keyless success responses. Keyless budget: 60 history calls per hour per IP; this call used 1.",
  };
}

async function changesTool(entity, args, tz, p, head) {
  const isPark = entity.type === "PARK";
  const now = Date.now();
  const date = ymd(args.date, "date");
  let startMs, endMs, path;
  let zoneNote;
  if (args.from && !YMD.test(String(args.from))) {
    const a = instantArg(args.from, tz, "from");
    const b = args.to ? instantArg(args.to, tz, "to") : { ms: now, iso: localTime(now, tz).iso };
    if (b.ms <= a.ms) throw new ToolError("bad_request", "to must be after from.");
    if (isPark && b.ms - a.ms > 26 * 3_600_000) throw new ToolError("bad_request", "A park-wide history covers one park-local day. Pass date=YYYY-MM-DD, or a range under a day.");
    if (!isPark && b.ms - a.ms > RAW_ENTITY_MAX_DAYS * 86_400_000) throw new ToolError("bad_request", `Minute-level history spans at most ${RAW_ENTITY_MAX_DAYS} days per call.`);
    startMs = a.ms;
    endMs = Math.min(b.ms, now);
    const parkOff = fmtOffset(tzOffsetMinutes(tz, a.ms));
    const given = String(args.from).match(/(Z|[+-]\d{2}:\d{2})$/)?.[1];
    const notes = [];
    if (given && (given === "Z" ? "+00:00" : given) !== parkOff) {
      notes.push(`from carried offset ${given}, but the park runs on ${parkOff}. The range was read as ${localTime(a.ms, tz).text} to ${localTime(b.ms, tz).text} park time. For park-local hours pass times without an offset, e.g. 2026-10-11T16:00.`);
    }
    if (a.ambiguousNote) notes.push(a.ambiguousNote);
    if (b.ambiguousNote) notes.push(b.ambiguousNote);
    zoneNote = notes.join(" ") || undefined;
    path = `/entity/${entity.id}/history?from=${encodeURIComponent(a.iso)}&to=${encodeURIComponent(b.iso)}`;
  } else {
    const day = date ?? ymd(args.from, "from") ?? todayIn(tz);
    const last = isPark ? day : ymd(args.to, "to") ?? day;
    if (daysBetween(day, last) < 0) throw new ToolError("bad_request", "from must be on or before to.");
    if (daysBetween(day, last) >= RAW_ENTITY_MAX_DAYS) throw new ToolError("bad_request", `Minute-level history spans at most ${RAW_ENTITY_MAX_DAYS} days per call.`);
    const start = localToInstant(`${day}T00:00`, tz);
    const end = localToInstant(`${addDays(last, 1)}T00:00`, tz);
    startMs = start.ms;
    endMs = Math.min(end.ms, now);
    zoneNote = [start.ambiguousNote, end.ambiguousNote].filter(Boolean).join(" ") || undefined;
    path = day === last ? `/entity/${entity.id}/history?date=${day}` : `/entity/${entity.id}/history?from=${day}&to=${last}`;
  }
  // historyEarliestDate from /v1/me is a UTC date. Compare UTC to UTC. Keyless has no such date; use the park-local day.
  const earliest = p.historyEarliestDate ?? addDays(todayIn(tz), 1 - windowDays(p));
  const startDay = p.historyEarliestDate ? new Date(startMs).toISOString().slice(0, 10) : todayIn(tz, startMs);
  if (!p.historyAllArchive && startDay < earliest) {
    throw new ToolError("history_window_exceeded", `That range starts before ${earliest}, the earliest day your access reaches.`, { earliestAllowedDate: earliest, hint: windowHint(p) });
  }
  const res = await historyCall(path, p);
  const { data } = res;
  const out = {
    ...head,
    granularity: "changes",
    range: { from: localTime(startMs, tz).iso, to: localTime(endMs, tz).iso, fromLocal: localTime(startMs, tz).text, toLocal: localTime(endMs, tz).text, requested: { date: args.date, from: args.from, to: args.to } },
    zoneNote,
    dataNote: "Rows are ThemeParks.wiki's recorded changes. Quote intervals and waits exactly as returned; do not round or merge them.",
    fetchedAt: res.fetchedAt,
    cached: res.cached,
    ...budgetReport(res, p),
  };
  if (!Array.isArray(data?.entities)) {
    return { ...out, opening: freshness(data?.opening, tz), changeRows: data?.history?.length ?? 0, ...timeline(data?.opening, data?.history ?? [], startMs, endMs, tz) };
  }
  const want = list(args.status, STATUSES, "status") ?? new Set(["DOWN"]);
  const types = list(args.type, ENTITY_TYPES, "type") ?? new Set(["ATTRACTION"]);
  const limit = int(args.limit, { min: 1, max: 1000, def: 200, name: "limit" });
  const events = [];
  const perEntity = [];
  let degraded = 0;
  for (const e of data.entities) {
    if (!types.has(e.entityType)) continue;
    if (e.opening?.degraded) degraded++;
    const t = timeline(e.opening, e.history ?? [], startMs, endMs, tz);
    const hits = t.intervals.filter((s) => want.has(s.status));
    for (const s of hits) events.push({ id: e.id, name: e.name, ...s });
    if (hits.length) perEntity.push({ id: e.id, name: e.name, spans: hits.length, minutes: hits.reduce((n, s) => n + s.minutes, 0) });
  }
  events.sort((a, b) => a.start.localeCompare(b.start));
  perEntity.sort((a, b) => b.minutes - a.minutes);
  return {
    ...out,
    statuses: [...want],
    entitiesInPark: data.entities.length,
    entitiesWithDegradedOpening: degraded || undefined,
    totalEvents: events.length,
    returned: Math.min(limit, events.length),
    byEntity: perEntity,
    events: events.slice(0, limit),
  };
}

async function uptimeTool(args) {
  const entity = await resolve(args.entity, args.within);
  const tz = entity.timezone || "UTC";
  const granularity = args.granularity ?? "daily";
  if (!["daily", "changes", "coverage"].includes(granularity)) throw new ToolError("bad_request", "granularity must be daily, changes, or coverage.");
  const p = await plan();
  const access = { tier: p.tier, keyConfigured: p.keyConfigured, historyDays: p.historyAllArchive ? "all" : p.historyDays, historyEarliestDate: p.historyEarliestDate ?? undefined, source: p.source };
  const head = { source: SOURCE, entity: entityHeader(entity), timezone: tz, access };
  if (granularity === "coverage") {
    const res = await api(`/entity/${entity.id}/history/coverage`);
    return { ...head, granularity, fetchedAt: res.fetchedAt, cached: res.cached, note: "Recording runs 2-3 days behind live data. Your plan limits how far back you can read, not what exists.", coverage: res.data };
  }
  if (granularity === "changes") {
    if (entity.type === "DESTINATION") throw new ToolError("bad_request", "Minute-level history works for a ride, show, or park, not a whole resort.");
    return changesTool(entity, args, tz, p, head);
  }
  const maxDays = windowDays(p);
  const to = ymd(args.to, "to") ?? todayIn(tz);
  const explicitFrom = ymd(args.from, "from");
  let clampNote;
  let from = explicitFrom;
  if (!explicitFrom) {
    const requestedDays = args.days === undefined || args.days === null || args.days === "" ? 7 : int(args.days, { min: 1, max: DAILY_MAX_DAYS, def: 7, name: "days" });
    const capped = Math.min(requestedDays, maxDays);
    if (requestedDays > capped) {
      clampNote = `Requested ${requestedDays} days; this access allows ${maxDays}. Returned the last ${capped} days ending ${to}.`;
    }
    from = addDays(to, 1 - capped);
  }
  if (daysBetween(from, to) < 0) throw new ToolError("bad_request", "from must be on or before to.");
  if (daysBetween(from, to) >= DAILY_MAX_DAYS) throw new ToolError("bad_request", `Daily history spans at most ${DAILY_MAX_DAYS} days per call.`);
  const inclusiveDays = daysBetween(from, to) + 1;
  const parkDailyMax = PARK_DAILY_MAX_PAGES * PARK_DAILY_PAGE_DAYS;
  if ((entity.type === "PARK" || entity.type === "DESTINATION") && inclusiveDays > parkDailyMax) {
    throw new ToolError(
      "bad_request",
      `Park and resort daily history is ${PARK_DAILY_PAGE_DAYS} days per page. This tool follows at most ${PARK_DAILY_MAX_PAGES} pages (${parkDailyMax} days, ${PARK_DAILY_MAX_PAGES} history calls). Narrow from/to.`,
      { maxDays: parkDailyMax, historyCalls: PARK_DAILY_MAX_PAGES },
    );
  }
  const sort = args.sort ?? "down_desc";
  if (!UPTIME_SORTS[sort]) throw new ToolError("bad_request", `sort must be one of ${Object.keys(UPTIME_SORTS).join(", ")}.`);
  const types = list(args.type, ENTITY_TYPES, "type") ?? new Set(["ATTRACTION"]);
  const limit = int(args.limit, { min: 1, max: 500, def: 25, name: "limit" });
  const res = await historyCall(`/entity/${entity.id}/history/daily?from=${from}&to=${to}`, p);
  const { data, fetchedAt, cached } = res;
  const base = {
    ...head,
    granularity: "daily",
    range: data?.range ?? { from, to },
    timezone: data?.timezone ?? tz,
    fetchedAt,
    cached,
    ...budgetReport(res, p),
    ...(clampNote ? { note: clampNote } : {}),
    method: "uptimePct = operatingMinutes / (operatingMinutes + downMinutes), inside published park hours when the park published any. Unknown and CLOSED minutes are excluded. Today counts elapsed minutes only.",
  };
  if (Array.isArray(data?.entities)) {
    const byId = new Map();
    const absorb = (d) => {
      for (const e of d?.entities ?? []) {
        const cur = byId.get(e.id) ?? { id: e.id, name: e.name, type: e.entityType, days: [] };
        cur.days.push(...(e.days ?? []));
        byId.set(e.id, cur);
      }
    };
    absorb(data);
    let next = data.next ?? null;
    let pages = 1;
    while (next && pages < PARK_DAILY_MAX_PAGES) {
      const rel = String(next).replace(/^https?:\/\/[^/]+\/v1/, "");
      const more = await historyCall(rel, p);
      absorb(more.data);
      next = more.data?.next ?? null;
      pages++;
    }
    const rows = [...byId.values()]
      .filter((e) => types.has(e.type))
      .map((e) => ({ id: e.id, name: e.name, type: e.type, ...summarize(e.days.map(toDailyUptime)) }))
      .filter((r) => r.daysWithData > 0)
      .sort(UPTIME_SORTS[sort]);
    return { ...base, pages, totalEntities: rows.length, returned: Math.min(limit, rows.length), entities: rows.slice(0, limit), next: next ?? null, truncated: next ? `Stopped after ${pages} pages; narrow the range.` : undefined };
  }
  const daily = (data?.days ?? []).map(toDailyUptime);
  return { ...base, firstRecordedAt: data?.coverage?.firstRecordedAt ?? null, summary: summarize(daily), days: daily };
}

// Watch: bounded WebSocket push (key required). Free plan: 1 connection, 1 subscription.
const WS_URL = "wss://api.themeparks.wiki/v1/live";
const WATCH_MAX_SECONDS = 120;
let WebSocketImpl = globalThis.WebSocket;
function setWebSocketImpl(impl) {
  WebSocketImpl = impl;
}

async function watchTool(entity, args, tz, parks) {
  if (!apiKey()) {
    throw new ToolError("key_required", "Live push (mode=watch) needs THEMEPARKS_API_KEY. Without a key, call themeparks_live again to poll; data refreshes about once a minute.", { getAKey: KEY_SIGNUP_URL });
  }
  if (typeof WebSocketImpl !== "function") {
    throw new ToolError("unsupported_runtime", `mode=watch needs a global WebSocket: Node 22+, or Node 20.10+ started with --experimental-websocket. This server runs Node ${process.versions.node}. Polling themeparks_live still works.`);
  }
  const seconds = int(args.watch_seconds, { min: 5, max: WATCH_MAX_SECONDS, def: 60, name: "watch_seconds" });
  const untilStatus = list(args.until_status, STATUSES, "until_status");
  const untilWait = args.until_wait_at_most === undefined ? null : int(args.until_wait_at_most, { min: 0, max: 1440, def: null, name: "until_wait_at_most" });
  const types = list(args.type, ENTITY_TYPES, "type");
  const single = !["DESTINATION", "PARK"].includes(entity.type);
  const started = Date.now();
  const snapshot = [];
  const updates = [];
  let welcome = null;
  let subscribed = null;
  let stopReason = "time_limit";
  let triggeredBy = null;
  let error = null;
  let snapshotComplete = false;
  let retriedSubscribe = false;
  let subMsg = null;
  const hasCondition = Boolean(untilStatus) || untilWait !== null;
  const matches = (live) => {
    if (single && live.id !== entity.id) return false;
    if (untilStatus && untilStatus.has(live.status)) return true;
    return untilWait !== null && live.standbyWait !== null && live.standbyWait <= untilWait;
  };
  const toLive = (raw) => toLiveStatus(raw, { parks, now: Date.now(), includeForecast: false, includeTimes: false, tz });

  await new Promise((resolveWatch) => {
    let ws;
    let done = false;
    const finish = (reason) => {
      if (done) return;
      done = true;
      if (reason) stopReason = reason;
      clearTimeout(timer);
      try {
        ws?.close(1000);
      } catch {}
      resolveWatch();
    };
    const timer = setTimeout(() => finish("time_limit"), seconds * 1000);
    try {
      ws = new WebSocketImpl(WS_URL, ["preview"]);
    } catch (err) {
      error = { code: "ws_connect_failed", message: String(err?.message || err) };
      finish("error");
      return;
    }
    ws.onopen = () => ws.send(JSON.stringify({ type: "auth", apiKey: apiKey() }));
    ws.onmessage = (ev) => {
      try {
        let f;
        try {
          f = JSON.parse(typeof ev.data === "string" ? ev.data : Buffer.from(ev.data).toString("utf8"));
        } catch {
          return;
        }
        if (f.type === "welcome") {
          welcome = { protocol: f.data?.protocol ?? null, limits: f.data?.limits ?? null, heartbeatIntervalMs: f.data?.heartbeatIntervalMs ?? null };
          subMsg = { type: "subscribe", channel: entity.id, snapshot: true };
          if (types && types.size === 1) subMsg.filter = [...types][0];
          ws.send(JSON.stringify(subMsg));
        } else if (f.type === "subscribed") {
          subscribed = { subscriptionId: f.data?.subscriptionId ?? null, name: f.data?.name ?? null, entityType: f.data?.entityType ?? null };
        } else if (f.type === "snapshot") {
          const rows = Array.isArray(f.data) ? f.data : [];
          for (const raw of rows) if (!types || types.has(raw.entityType)) snapshot.push(toLive(raw));
          if (f.final === true) snapshotComplete = true;
          if (f.final === true && hasCondition && args.stop_if_already_met) {
            const hit = snapshot.find(matches);
            if (hit) {
              triggeredBy = { ...hit, fromSnapshot: true };
              finish("condition_met");
            }
          }
          if (f.final === true && !hasCondition && args.snapshot_only) finish("snapshot_only");
        } else if (f.type === "update") {
          if (types && !types.has(f.data?.entityType)) return;
          const live = toLive(f.data ?? {});
          const at = localTime(f.ts ?? Date.now(), tz);
          const before = [...snapshot, ...updates].filter((u) => u.id === live.id).at(-1);
          updates.push({ at: at.iso, atLocal: at.text, ...live, previousStatus: before?.status, previousWait: before?.standbyWait });
          if (hasCondition && matches(live)) {
            triggeredBy = updates.at(-1);
            finish("condition_met");
          }
        } else if (f.type === "error") {
          const retryable = Boolean(f.data?.retryable);
          if (retryable && !subscribed && !retriedSubscribe && subMsg) {
            retriedSubscribe = true;
            error = null;
            ws.send(JSON.stringify(subMsg));
            return;
          }
          error = { code: f.data?.code ?? null, message: f.data?.message ?? "error", retryable };
          finish("error");
        }
      } catch (err) {
        error = { code: "ws_message", message: err?.message || String(err) };
        finish("error");
      }
    };
    ws.onerror = () => {
      error = error ?? { code: "ws_error", message: "WebSocket error" };
    };
    ws.onclose = (ev) => {
      const codes = { 3000: "Authentication failed (check THEMEPARKS_API_KEY)", 3001: "Query-string credentials rejected", 3003: "Insufficient permissions", 4029: "Connection cap for your plan reached (free plan: 1 connection). Close other ThemeParks.wiki sockets and retry." };
      if (!done && ev?.code && ev.code !== 1000) error = { code: ev.code, message: codes[ev.code] ?? `closed ${ev.code}` };
      finish(error ? "error" : "closed");
    };
  });

  if (error && stopReason === "error") throw new ToolError("watch_failed", error.message, { closeCode: error.code, retryable: error.retryable ?? undefined });
  return {
    mode: "watch",
    watchedSeconds: Math.round((Date.now() - started) / 1000),
    stopReason,
    triggeredBy: triggeredBy ?? undefined,
    connection: welcome ?? undefined,
    subscription: subscribed ?? undefined,
    snapshotPartial: snapshotComplete ? undefined : true,
    snapshot: single ? snapshot.find((s) => s.id === entity.id) ?? snapshot[0] ?? null : { entities: snapshot.length, counts: Object.fromEntries(STATUSES.map((s) => [s, snapshot.filter((x) => x.status === s).length])) },
    updateCount: updates.length,
    updates: updates.slice(-200),
    note: "Preview WebSocket (wss://api.themeparks.wiki/v1/live): one connection, one subscription, at most 120s, closed before returning. until_status and until_wait_at_most are OR: either match stops the watch.",
  };
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
        include_details: { type: "boolean", description: `Add ride details per match (attractionType, minimumHeight/maximumHeight in cm, mayGetWet, location, other park tags). One extra call per match, first ${DETAILS_MAX} only. Default false.` },
        mode: { type: "string", enum: ["search", "key_status"], description: "search (default). key_status reports whether THEMEPARKS_API_KEY is set and, if so, the plan, history window, and remaining budgets from /v1/me. The key itself is never shown." },
      },
    },
    handler: findTool,
  },
  themeparks_live: {
    description:
      "Live status and waits for a park, resort, or single ride/show: status OPERATING|DOWN|CLOSED|REFURBISHMENT, standby, single rider, paid standby, virtual queue and Lightning Lane return windows, boarding groups, lastUpdated. A single ride also gets details (height limits, mayGetWet, type) and bestTimeToRide: today's lowest predicted wait window with crowd percentage (forecasts exist only at Walt Disney World and Disneyland Resort). mode=watch (optional key) waits for pushed changes, e.g. until a DOWN ride reopens.",
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
        include_details: { type: "boolean", description: "For a single ride: include details (attractionType, height limits in cm, mayGetWet, location). Default true." },
        mode: { type: "string", enum: ["snapshot", "watch"], description: "snapshot (default) reads current state. watch (needs THEMEPARKS_API_KEY and a global WebSocket: Node 22+, or Node 20.10+ with --experimental-websocket) opens the push WebSocket, takes a snapshot, then collects changes for watch_seconds or until a condition is met. Free plan: one connection at a time." },
        watch_seconds: { type: "integer", description: `watch: how long to listen, 5-${WATCH_MAX_SECONDS} seconds (default 60). Values above ${WATCH_MAX_SECONDS} are clamped.` },
        until_status: { type: "string", description: "watch: stop early when a watched entity reaches one of these statuses, e.g. OPERATING. OR'd with until_wait_at_most: either condition stops the watch." },
        until_wait_at_most: { type: "integer", description: "watch: stop early when a standby wait drops to this many minutes or less. OR'd with until_status: either condition stops the watch." },
        stop_if_already_met: { type: "boolean", description: "watch: return at once if the snapshot already meets the condition. Default false." },
        snapshot_only: { type: "boolean", description: "watch without a condition: return right after the snapshot. Default false." },
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
      "Ride history. granularity=daily (default): uptime %, minutes operating/down, first open/last close, wait stats per day; a park ranks its rides by downtime. granularity=changes: minute-level status intervals (DOWN/OPERATING spans in park time), wait timeline, and opening freshness for a ride over a time range (from/to like 2026-10-11T16:00 park time), or for a park on one date every event of a status (default DOWN). granularity=coverage: how far back data exists. Keyless reaches 7 days (60 history calls/hour); a key extends it to the plan's window.",
    inputSchema: {
      type: "object",
      required: ["entity"],
      properties: {
        entity: ENTITY_ARG,
        within: WITHIN_ARG,
        granularity: { type: "string", enum: ["daily", "changes", "coverage"], description: "daily (default), changes (minute-level), or coverage." },
        days: { type: "integer", description: "daily: days ending today (default 7, up to your plan window: 7 keyless, 30 free key, more on paid plans). A larger days value is clamped and the result note says so. Park and resort ranges follow at most 15 pages (465 days, one history call per page)." },
        date: { type: "string", description: "changes: one park-local day YYYY-MM-DD (default today). Required form for a park." },
        from: { type: "string", description: "daily: start YYYY-MM-DD. changes: YYYY-MM-DD, or a park-local time 2026-10-11T16:00, or an RFC 3339 instant." },
        to: { type: "string", description: "daily: end YYYY-MM-DD (default today). changes: end time (exclusive) in the same form as from; default now." },
        status: { type: "string", description: "changes on a park: statuses to list as events, comma-separated (default DOWN)." },
        type: { type: "string", description: "For a park: entity types to include, comma-separated. Default ATTRACTION." },
        sort: { type: "string", enum: Object.keys(UPTIME_SORTS), description: "For a park: default down_desc." },
        limit: { type: "integer", description: "For a park: max rides (daily, default 25) or events (changes, default 200)." },
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
    return { isError: false, payload: { ...(await tool.handler(args ?? {})), attribution: ATTRIBUTION } };
  } catch (err) {
    if (err instanceof ToolError) return { isError: true, payload: { error: err.code, message: err.message, ...err.extra, attribution: ATTRIBUTION } };
    return { isError: true, payload: { error: "internal_error", message: err?.message || String(err), attribution: ATTRIBUTION } };
  }
}

// ---------------------------------------------------------------------------
// stdio JSON-RPC (Content-Length or newline framing)
// ---------------------------------------------------------------------------

let writeOut = (buf) => stdout.write(buf);

function send(msg, frame) {
  const payload = Buffer.from(JSON.stringify(msg), "utf8");
  const out = frame === "lf"
    ? Buffer.concat([payload, Buffer.from("\n")])
    : Buffer.concat([Buffer.from(`Content-Length: ${payload.length}\r\n\r\n`), payload]);
  writeOut(out);
}

function _setStdoutSink(fn) {
  writeOut = fn;
}

async function handle(msg, frame) {
  if (!msg || typeof msg !== "object") return;
  const { id, method } = msg;
  if (id === undefined || id === null) return;
  const ok = (result) => send({ jsonrpc: "2.0", id, result }, frame);
  const fail = (code, message) => send({ jsonrpc: "2.0", id, error: { code, message } }, frame);
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

let responseChain = Promise.resolve();

function dispatch(body, frame) {
  let parsed;
  try {
    parsed = JSON.parse(body);
  } catch {
    send({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }, frame);
    return responseChain;
  }
  const run = responseChain.then(() => handle(parsed, frame));
  responseChain = run.then(() => {}, () => {});
  return run;
}

function _dispatchIncoming(body, frame = "content-length") {
  return dispatch(body, frame);
}

function pump() {
  while (buf.length) {
    if (/^Content-Length\s*:/i.test(buf.subarray(0, 32).toString("utf8"))) {
      const sep = buf.indexOf("\r\n\r\n");
      if (sep === -1) return;
      const len = Number(buf.subarray(0, sep).toString("utf8").match(/Content-Length:\s*(\d+)/i)?.[1]);
      const start = sep + 4;
      if (!Number.isFinite(len)) return;
      if (buf.length < start + len) return;
      const body = buf.subarray(start, start + len).toString("utf8");
      buf = buf.subarray(start + len);
      dispatch(body, "content-length");
      continue;
    }
    const nl = buf.indexOf("\n");
    if (nl === -1) return;
    const line = buf.subarray(0, nl).toString("utf8").replace(/\r$/, "");
    buf = buf.subarray(nl + 1);
    if (line.trim()) dispatch(line, "lf");
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

export { SERVER_INFO, TOOL_REGISTRY, QUEUE_FIELDS, ATTRIBUTION, listTools, callTool, normalize, score, rank, toLiveStatus, toDailyUptime, uptimePct, bestTimeToRide, timeline, localToInstant, localTime, rideDetails, setWebSocketImpl, _setStdoutSink, _dispatchIncoming };

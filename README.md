# themeparks-web

<p align="center">
  <img src="assets/logo-plate.png" alt="themeparks-web" width="160" height="160" />
</p>

Live theme park data for Grok Bot and other MCP hosts. Ask "what's down at Universal right now", "shortest waits at Magic Kingdom", "how long is VelociCoaster", "best time to ride Space Mountain today", "how tall do you have to be for NightFlight Expedition", "when exactly was NightFlight down Sunday afternoon", "every breakdown at Magic Kingdom on Oct 11", or "when does EPCOT open Tuesday".

**[Powered by ThemeParks.wiki](https://themeparks.wiki).** Every tool result carries this credit as `attribution`, and the skill tells the assistant to include it in answers.

Version 0.1.4. Agent Plugin format. Zero npm dependencies. Node.js 18+. MIT.

**Data credit.** All data comes from the free [ThemeParks.wiki API](https://www.themeparks.wiki/api) (v1, `https://api.themeparks.wiki/v1`). Thank you to the ThemeParks.wiki project. It reads the parks' own apps, so the data is unofficial. This plugin is not affiliated with ThemeParks.wiki, Disney, Universal, or any park operator. See [TERMS.md](TERMS.md) and [PRIVACY.md](PRIVACY.md).

**Repo:** https://github.com/TheAbsentTourist/themeparks-web · **Author:** TheAbsentTourist · chucktastictime@gmail.com

## Tools

Four tools. Each takes flags instead of splitting into many endpoint tools.

| Tool | What it answers | Flags |
|------|-----------------|-------|
| `themeparks_find` | Find a resort, park, ride, show, restaurant, or hotel by fuzzy name; ride details; key status | `query`, `within`, `type`, `limit`, `include_details`, `mode` (`search`, `key_status`). No args lists all 160+ destinations |
| `themeparks_live` | Status and waits right now for a resort, park, or one ride; ride details; best time to ride; optional live push | `entity`, `within`, `type`, `status`, `min_wait`, `max_wait`, `sort` (`wait_desc`, `wait_asc`, `name`, `status`), `limit`, `include_forecast`, `include_times`, `include_details`, `mode` (`snapshot`, `watch`), `watch_seconds`, `until_status`, `until_wait_at_most`, `stop_if_already_met`, `snapshot_only` |
| `themeparks_schedule` | Published park hours over a date range | `entity`, `within`, `from`, `days` (max 62), `type`, `include_purchases` |
| `themeparks_uptime` | History. `daily`: uptime %, down minutes, wait stats; a park ranks rides by downtime. `changes`: minute-level status intervals and wait timeline for a ride over a time range, or every DOWN (or other status) span at a park on one day. `coverage`: how far back data exists | `entity`, `within`, `granularity` (`daily`, `changes`, `coverage`), `days`, `date`, `from`, `to` (dates or park-local times like `2026-10-11T16:00`), `status`, `type`, `sort`, `limit` |

`entity` accepts a name, a UUID, a slug, or a destination externalId (ids and slugs resolve in one call). `within` is optional. Without it, a ride name is searched across major resorts first (about 23 API calls on a cold cache), then across every destination only if nothing matched. Resort entity lists are cached for 6 hours, so later lookups are free. `{"entity": "VelociCoaster"}` resolves to Islands of Adventure on its own.

When several parks share a ride name, `themeparks_live` shows all of them (`"Space Mountain"` returns Magic Kingdom and Disneyland). The other tools return `ambiguous` with `candidates` instead of guessing. Ambiguous park names such as "Disneyland Park" (Anaheim and Paris) also return `candidates`.

## Domain shape

```text
Entity      = { id, name, type: DESTINATION|PARK|ATTRACTION|SHOW|RESTAURANT|HOTEL, park?, destination?, timezone? }
LiveStatus  = { id, name, type, park, status: OPERATING|DOWN|CLOSED|REFURBISHMENT,
                standbyWait, singleRiderWait?, paidStandbyWait?,
                returnTime? {state, start, end}, paidReturnTime? {state, start, end, price},
                boardingGroup? {state, currentGroupStart, currentGroupEnd, nextAllocationTime, estimatedWait},
                otherQueues?, showtimes?, operatingHours?, forecast? [{time, waitTime, percentage}], diningAvailability?,
                bestTimeToRide? {available, start, end, startLocal, endLocal, predictedWait, percentage} | {available:false, reason},
                lastUpdated, ageMinutes, stale? }
RideDetails = { attractionType, minimumHeight, maximumHeight, heightUnit: "cm", mayGetWet, location {latitude, longitude}, ...other park tags }
ScheduleDay = { date, entries: [{ park?, type: OPERATING|TICKETED_EVENT|EXTRA_HOURS|PRIVATE_EVENT|INFO, open, close, description?, purchases? }] }
Resort schedule also includes parks: [{ id, name }] for each park at the destination.
StatusSpan  = { status, start, end, startLocal, endLocal, minutes, openEnded? }      // park time zone
Opening     = { status, standbyWait, observedAt, observedAtLocal, carriedInMinutes, staleCarryIn?, degraded?, degradedReason? }
DailyUptime = { date, uptimePct, basis, operatingMinutes, downMinutes, unknownMinutes, scheduledMinutes,
                firstOperatingAt, lastClosedAt, standby {min, p50, mean, p90, max} }
```

`uptimePct = operatingMinutes / (operatingMinutes + downMinutes)`, counted inside the park's published hours when it published any. Unknown and CLOSED minutes are left out. Today counts elapsed minutes only.

## Freshness, limits, and errors

- Every call returns `fetchedAt` and `cached`. Every live item returns `lastUpdated` and `ageMinutes`. An item the park has not updated in over 24 hours carries `stale: true`.
- The server caches in memory: live data for 60 seconds (upstream refreshes about once a minute), resort entity lists for 6 hours, everything else for 5 minutes. An entry is dropped after its TTL plus a grace window (live 5 minutes, history 30 minutes, children 1 hour, other data 15 minutes).
- Upstream allows 300 requests a minute per IP. This process also fails with `retryAfterSeconds` once it has used that budget (or the limit `/v1/me` reports), without sleeping. History calls (`themeparks_uptime`) share 60 an hour without a key.
- On HTTP 429, a network error, or HTTP 502/503/504, a cached answer inside the grace window is served and marked `staleBecause` (`rate_limited`, `network_error`, or `upstream_error`). Past that window the tool returns the error, including `retryAfterSeconds` when the upstream sent one (`retryAfter`, `error.retryAfter`, or the `Retry-After` header).
- Keyless history reaches back 7 days. Asking for earlier days with `from`/`to` returns `history_window_exceeded` with `earliestAllowedDate`. A `days` value past the plan window is clamped and the result includes `note` naming the requested days, the allowed days, and the range returned. Keyless history that includes today can lag the live feed by up to an hour.
- Park and destination daily history is 31 days per page. The tool follows at most 15 pages (465 days, 15 history calls) and rejects a longer range with `bad_request` instead of returning a partial rollup. A single ride can still span up to 3,660 days in one call.
- An all-resort search that hits a non-429 error records `scan.stoppedBy`. If nothing useful was scanned, or the best score is below 0.9, that error is returned instead of `not_found`.
- Redirects are followed only while they stay on `https://api.themeparks.wiki`.
- History results report `historyBudget` from the `RateLimit-History-*` headers when ThemeParks.wiki sends them (it does for keyed calls; keyless success responses carry none, so a note states the 60-an-hour keyless budget).
- Best time to ride needs ThemeParks.wiki's wait forecast, which exists only for Walt Disney World and Disneyland Resort parks. Elsewhere `bestTimeToRide.available` is false with that reason. Hours are bucketed in the park's time zone. A wall time that falls in a daylight-saving gap returns `bad_request`; a repeated hour sets `ambiguousNote`.

## Optional API key

Never required; every tool works keyless. **Get a free key:** create an account at https://www.themeparks.wiki/register, then generate a key on https://www.themeparks.wiki/profile. Set `THEMEPARKS_API_KEY` (declared `secret` in the manifest). It is sent only to `api.themeparks.wiki` as `x-api-key` (or the WebSocket auth frame), never logged, never returned. An unexpanded `${THEMEPARKS_API_KEY}` placeholder counts as no key.

| With a key | What changes |
|---|---|
| History window | Follows `/v1/me`: free 30 days, paid plans longer, all-archive reads everything. `days` past that window is clamped and `note` says so. Daily ranges up to 3,660 days; park and destination daily is capped at 15 pages. |
| History budget | Free: 600 calls an hour (keyless 60). Reported as `historyBudget`. |
| `themeparks_find mode=key_status` | Plan, history window, earliest date, both budgets. Without a key: the signup links. |
| `themeparks_live mode=watch` | One bounded WebSocket session (`wss://api.themeparks.wiki/v1/live`, preview protocol): snapshot (`final: true` on the last chunk), then changes for up to 120 s or until `until_status` or `until_wait_at_most` (either match stops the watch). Free plan: 1 connection, 1 subscription. Needs a global WebSocket: Node 22+, or Node 20.10+ started with `--experimental-websocket`. Without a key: `key_required`. |

## Known limits

- **Unofficial and a few minutes behind.** Status and waits come from the parks' apps through ThemeParks.wiki. Live data updates about once a minute, and a ride can show DOWN a few minutes after it actually stops.
- **History is 7 days without a key.** A free key extends this to 30 days. `days` above the window is clamped and `note` says so; `from`/`to` past the window returns `history_window_exceeded`. Keyless history that includes today can lag live data by up to an hour.
- **60 history calls an hour without a key.** One ride or one park-day of minute history spends one call. Park and destination daily history spends one call per page, at most 15 (31 days each).
- **300 requests a minute per IP**, shared by every tool. A cold all-resort name search spends about 23, or about 160 in the worst case (no match anywhere). This process fails the call with `retryAfterSeconds` at the same budget instead of sleeping.
- **Push is bounded.** `mode=watch` listens for at most 120 s per call (`watch_seconds` above 120 is clamped), then closes. A chunked snapshot is complete only when `final` is true. For longer "tell me when it reopens", pair with a scheduled routine. The WebSocket is a ThemeParks.wiki preview; its frame shape may change. Needs Node 22+, or Node 20.10+ with `--experimental-websocket`.
- **Park-wide minute history is one day per call**, and a single ride at most 31 days per call (upstream limits).

## Install in Grok Bot

Grok Bot runs this as a local stdio MCP connector on Grok Bot's computer.

1. Put the folder at `~/.cursor/plugins/local/themeparks-web` (a real directory).
2. Add a stdio MCP connector named `themeparks-web` with command `node` and args `["/home/box/.cursor/plugins/local/themeparks-web/server.mjs"]`. No env is needed. Optionally set `THEMEPARKS_API_KEY`; on Node 20 also put `--experimental-websocket` before the script path so `mode=watch` works.
3. The tools then appear as `themeparks_find`, `themeparks_live`, `themeparks_schedule`, and `themeparks_uptime`.

Other Agent Plugin hosts use the shipped `mcp.json` (`node ./server.mjs`, `cwd: "./"`).

**Limitation.** A stdio server needs a host that can start `node`. Sandboxed desktop builds that cannot spawn host Node (for example the Bazzite AppImage) load the skill but not the tools. A hosted HTTPS MCP would remove that requirement later. Nothing is hosted today.

## Verify

```bash
npm run check      # node --check server.mjs
npm run mcp-path   # offline: mcp.json shape, variables, version sync
npm run offline    # offline: 429, serve-stale on 429, search stop on 429, queue mapping, optional key header
npm run offline-regression  # offline: 0.1.3 regressions incl. real NightFlight Oct 11 rows
npm run offline-keyed  # offline: keyed plans, history math, paging, mock WebSocket watch
npm run offline-audit  # offline: 0.1.4 audit fixes (search errors, stdio, cache, redirects, dates, watch, paging, names, retryAfter, clamp note)
npm run smoke      # live keyless stdio MCP checks; add --keyed with THEMEPARKS_API_KEY set for live key checks
```

See [VERIFY.md](VERIFY.md) for the latest recorded run.

## Not included

- The firehose (`all`) WebSocket channel (paid plans) and long-lived subscriptions.
- Hosting. ThemeParks.wiki's terms forbid republishing the data as an API; this runs locally per user.

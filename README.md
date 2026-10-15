# themeparks-web

<p align="center">
  <img src="assets/logo-plate.png" alt="themeparks-web" width="160" height="160" />
</p>

Live theme park data for Grok Bot and other MCP hosts. Ask "what's down at Universal right now", "shortest waits at Magic Kingdom", "how long is VelociCoaster", "when does EPCOT open Tuesday", or "how often did Space Mountain break down this week".

Version 0.1.1. Agent Plugin format. Zero npm dependencies. Node.js 18+. MIT.

**Data credit.** All data comes from the free [ThemeParks.wiki API](https://www.themeparks.wiki/api) (v1, `https://api.themeparks.wiki/v1`). Thank you to the ThemeParks.wiki project. It reads the parks' own apps, so the data is unofficial. This plugin is not affiliated with ThemeParks.wiki, Disney, Universal, or any park operator. See [TERMS.md](TERMS.md) and [PRIVACY.md](PRIVACY.md).

**Repo:** https://github.com/TheAbsentTourist/themeparks-web · **Author:** TheAbsentTourist · chucktastictime@gmail.com

## Tools

Four tools. Each takes flags instead of splitting into many endpoint tools.

| Tool | What it answers | Flags |
|------|-----------------|-------|
| `themeparks_find` | Find a resort, park, ride, show, restaurant, or hotel by fuzzy name | `query`, `within`, `type`, `limit`. No args lists all 160+ destinations |
| `themeparks_live` | Status and waits right now for a resort, park, or one ride | `entity`, `within`, `type`, `status`, `min_wait`, `max_wait`, `sort` (`wait_desc`, `wait_asc`, `name`, `status`), `limit`, `include_forecast`, `include_times` |
| `themeparks_schedule` | Published park hours over a date range | `entity`, `within`, `from`, `days` (max 62), `type`, `include_purchases` |
| `themeparks_uptime` | Daily uptime %, down minutes, and wait stats; for a park, rides ranked by downtime | `entity`, `within`, `days`, `from`, `to`, `type`, `sort` (`down_desc`, `uptime_asc`, `name`), `limit` |

`entity` accepts a name or an id. `within` is optional. Without it, a ride name is searched across major resorts first (about 23 API calls on a cold cache), then across every destination only if nothing matched. Resort entity lists are cached for 6 hours, so later lookups are free. `{"entity": "VelociCoaster"}` resolves to Islands of Adventure on its own.

When several parks share a ride name, `themeparks_live` shows all of them (`"Space Mountain"` returns Magic Kingdom and Disneyland). The other tools return `ambiguous` with `candidates` instead of guessing. Ambiguous park names such as "Disneyland Park" (Anaheim and Paris) also return `candidates`.

## Domain shape

```text
Entity      = { id, name, type: DESTINATION|PARK|ATTRACTION|SHOW|RESTAURANT|HOTEL, park?, destination?, timezone? }
LiveStatus  = { id, name, type, park, status: OPERATING|DOWN|CLOSED|REFURBISHMENT,
                standbyWait, singleRiderWait?, paidStandbyWait?,
                returnTime? {state, start, end}, paidReturnTime? {state, start, end, price},
                boardingGroup? {state, currentGroupStart, currentGroupEnd, nextAllocationTime, estimatedWait},
                otherQueues?, showtimes?, operatingHours?, forecast?, diningAvailability?,
                lastUpdated, ageMinutes, stale? }
ScheduleDay = { date, entries: [{ type: OPERATING|TICKETED_EVENT|EXTRA_HOURS|PRIVATE_EVENT|INFO, open, close, description?, purchases? }] }
DailyUptime = { date, uptimePct, basis, operatingMinutes, downMinutes, unknownMinutes, scheduledMinutes,
                firstOperatingAt, lastClosedAt, standby {min, p50, mean, p90, max} }
```

`uptimePct = operatingMinutes / (operatingMinutes + downMinutes)`, counted inside the park's published hours when it published any. Unknown and CLOSED minutes are left out. Today counts elapsed minutes only.

## Freshness, limits, and errors

- Every call returns `fetchedAt` and `cached`. Every live item returns `lastUpdated` and `ageMinutes`. An item the park has not updated in over 24 hours carries `stale: true`.
- The server caches in memory: live data for 60 seconds (upstream refreshes about once a minute), resort entity lists for 6 hours, everything else for 5 minutes.
- Upstream allows 300 requests a minute per IP. History calls (`themeparks_uptime`) share 60 an hour without a key.
- On HTTP 429 the tool returns `error: "rate_limited"` with `retryAfterSeconds`. If an older cached answer exists it is served instead, marked `staleBecause: "rate_limited"`.
- Keyless history reaches back 7 days. Asking for earlier days returns `history_window_exceeded` with `earliestAllowedDate`.

## Optional API key

Not needed. Every tool works keyless. A free key from [themeparks.wiki/api](https://www.themeparks.wiki/api) raises the history budget to 600 calls an hour and the window to 30 days. Set `THEMEPARKS_API_KEY` under Plugins → Configure. It is sent as the `x-api-key` header only when set. An unexpanded `${THEMEPARKS_API_KEY}` placeholder is treated as no key.

## Known limits

- **Unofficial and a few minutes behind.** Status and waits come from the parks' apps through ThemeParks.wiki. Live data updates about once a minute, and a ride can show DOWN a few minutes after it actually stops.
- **History is 7 days without a key.** `themeparks_uptime` cannot see earlier days keyless. A free key extends this to 30 days.
- **60 history calls an hour without a key.** Each `themeparks_uptime` call spends one.
- **300 requests a minute per IP**, shared by every tool. A cold all-resort name search spends about 23, or about 160 in the worst case (no match anywhere).
- **No WebSocket push.** Tools poll on request; they don't send alerts by themselves. Pair with a scheduled routine for "tell me when it reopens".

## Install in Grok Bot

Grok Bot runs this as a local stdio MCP connector on Grok Bot's computer.

1. Put the folder at `~/.cursor/plugins/local/themeparks-web` (a real directory).
2. Add a stdio MCP connector named `themeparks-web` with command `node` and args `["/home/box/.cursor/plugins/local/themeparks-web/server.mjs"]`. No env is needed. Optionally set `THEMEPARKS_API_KEY`.
3. The tools then appear as `themeparks_find`, `themeparks_live`, `themeparks_schedule`, and `themeparks_uptime`.

Other Agent Plugin hosts use the shipped `mcp.json` (`node ./server.mjs`, `cwd: "./"`).

**Limitation.** A stdio server needs a host that can start `node`. Sandboxed desktop builds that cannot spawn host Node (for example the Bazzite AppImage) load the skill but not the tools. A hosted HTTPS MCP would remove that requirement later. Nothing is hosted today.

## Verify

```bash
npm run check      # node --check server.mjs
npm run mcp-path   # offline: mcp.json shape, variables, version sync
npm run offline    # offline: 429, serve-stale on 429, search stop on 429, queue mapping, optional key header
npm run smoke      # live: 30 stdio MCP checks against api.themeparks.wiki
```

See [VERIFY.md](VERIFY.md) for the latest recorded run.

## Not included

- The WebSocket live feed (needs a key and a long-lived connection; poor fit for request/response MCP tools).
- Raw per-change `/history` rows. `themeparks_uptime` uses the daily summaries, which answer the uptime question in one call.
- `/v1/me` (key plan info). It needs a key and answers no park question.

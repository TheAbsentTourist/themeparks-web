---
name: themeparks-web
description: >
  Use when the user asks about theme park ride wait times, whether a ride is
  open, down, closed, or in refurbishment, when a ride went down or came back,
  the best time to ride today, height limits or whether a ride gets you wet,
  virtual queue or Lightning Lane return windows, showtimes, park opening hours,
  or how often a ride breaks down (Disney, Universal, SeaWorld, Six Flags,
  Dollywood, Europa-Park, and other ThemeParks.wiki destinations). Call the
  themeparks-web MCP tools. Never invent waits, statuses, times, or hours.
---

# Theme parks (themeparks-web 0.1.4)

Call only the themeparks-web tools and report what they return. Always say how
fresh the data is (`lastUpdated` per item, `fetchedAt` per call). Data is
unofficial and comes from the parks' own apps via ThemeParks.wiki.

**Credit, every time.** Every result carries `attribution`. End every answer
built from these tools with its markdown link:
[Powered by ThemeParks.wiki](https://themeparks.wiki). ThemeParks.wiki's free
use requires it.

## Which tool

| Need | Tool | Key flags |
|------|------|-----------|
| Find a resort, park, ride, show, restaurant | `themeparks_find` | `query`; optional `within`; `type`; no args lists all destinations |
| Height limits, gets-wet, ride type, location | `themeparks_find` `include_details=true`, or `themeparks_live` on one ride (`entity.details`) | heights are cm |
| Current waits at a park or resort | `themeparks_live` | `entity`; `type=ATTRACTION`; `sort=wait_desc` (default) or `wait_asc` |
| What is down or closed right now | `themeparks_live` | `status=DOWN` or `DOWN,CLOSED,REFURBISHMENT` |
| Short waits only | `themeparks_live` | `max_wait=20` (or `min_wait`) |
| One ride now + best time to ride today | `themeparks_live` | `entity="Space Mountain", within="Magic Kingdom"`; read `bestTimeToRide` |
| Tell me when a ride reopens / wait drops | `themeparks_live` | `mode=watch`, `until_status=OPERATING` or `until_wait_at_most=30` (either match stops the watch), `watch_seconds` ≤120 (needs key; Node 22+ or Node 20.10+ with `--experimental-websocket`) |
| Showtimes and ride hours today | `themeparks_live` | `include_times=true` |
| Park hours for a date range (park or whole resort) | `themeparks_schedule` | `from`, `days` (max 62), `type`, `include_purchases` |
| When exactly a ride was down, waits over an afternoon | `themeparks_uptime` | `granularity=changes`, `from="2026-10-11T16:00"`, `to="2026-10-11T18:00"` (park-local) |
| Every breakdown at a park on one day | `themeparks_uptime` | `entity=<park>`, `granularity=changes`, `date=YYYY-MM-DD`, `status=DOWN` (default) |
| Uptime % per day, which rides broke down most | `themeparks_uptime` | `granularity=daily` (default), `days` |
| How far back history exists | `themeparks_uptime` | `granularity=coverage` |
| Is a key set, what plan, budget left | `themeparks_find` | `mode=key_status` |

## Names

- `entity` takes a fuzzy name, a UUID, a slug, or a destination externalId. Ids and slugs resolve in one call.
- `within=<park or resort>` is optional but faster and avoids look-alikes.
- `themeparks_live` with a name shared by several parks returns all of them (`SAME_NAME_GROUP`). Say which park each line is.
- On `error: "ambiguous"`, pick from `candidates` or ask. On `not_found`, follow `hint`.

## Reading results

- Status: OPERATING, DOWN (temporarily stopped), CLOSED, REFURBISHMENT. `standbyWait` is minutes; `null` means no posted wait.
- `stale: true` means no feed update in 24 hours. Say so.
- `bestTimeToRide` is the longest window with today's lowest predicted wait, from the current hour on, with ThemeParks.wiki's crowd `percentage`. Forecasts exist only at Walt Disney World and Disneyland Resort; elsewhere `available: false` with a reason. Say it is a prediction.
- For history, pass park-local times without an offset (`2026-10-11T16:00`). If `zoneNote` or `ambiguousNote` is present, the range was read in a different window than the user may mean: say so. A time that does not exist (a daylight-saving gap) returns `bad_request`; ask for a real clock time.
- Quote intervals, minutes and waits exactly as returned. Never round, merge, or fill them from daily stats.
- History `intervals` are status spans with `startLocal`/`endLocal` in the park's time zone. Quote those times with the zone label. `openEnded: true` means the span ran past the end of the range.
- `opening` is the state when the range began: `observedAt` is when it was last seen. A large `carriedInMinutes` or `staleCarryIn` means the start state is old; `degraded: true` means it may be incomplete. Say so.
- `uptimePct` is operating / (operating + down) inside published hours. Today is partial. Keyless history that includes today can lag the live feed by up to an hour; say so when the range includes today and no key is configured.
- History limits: keyless 7 days and 60 history calls per hour. With a key the window follows the plan (`access`). On `history_window_exceeded`, tell the user and quote `hint`. If `note` says the requested `days` were clamped, quote that note. Park and destination daily history is at most 15 pages (465 days, 15 history calls); a longer range is `bad_request`.
- `historyBudget` (when present) is the remaining history calls this hour. On `rate_limited`, wait `retryAfterSeconds`; do not loop.
- `mode=watch` without a key returns `key_required`: offer to poll instead. A free key allows one watch at a time. `until_status` and `until_wait_at_most` are OR. If `snapshotPartial` is true, the snapshot was still arriving when the watch ended.

## Optional key

Never required. If the user wants 30 days of history or live push, point them to
https://www.themeparks.wiki/register (free account), then the key page
https://www.themeparks.wiki/profile, and set `THEMEPARKS_API_KEY`. Never ask the
user to paste a key into chat, and never repeat one back.

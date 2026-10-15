---
name: themeparks-web
description: >
  Use when the user asks about theme park ride wait times, whether a ride is
  open, down, closed, or in refurbishment, virtual queue or Lightning Lane
  return windows, showtimes, park opening hours, or how often a ride has broken
  down recently (Disney, Universal, SeaWorld, Six Flags, Europa-Park, and other
  ThemeParks.wiki destinations). Call the themeparks-web MCP tools. Never invent
  waits, statuses, or hours.
---

# Theme parks (themeparks-web 0.1.1)

Call only the themeparks-web tools and report what they return. Always say how
fresh the data is (`lastUpdated` per item, `fetchedAt` per call). Data is
unofficial and comes from the parks' own apps via ThemeParks.wiki.

## Which tool

| Need | Tool | Key flags |
|------|------|-----------|
| Find a resort, park, ride, show, restaurant | `themeparks_find` | `query`; optional `within`; `type`; no args lists all destinations |
| Current waits at a park or resort | `themeparks_live` | `entity`; `type=ATTRACTION`; `sort=wait_desc` (default) or `wait_asc` |
| What is down or closed right now | `themeparks_live` | `status=DOWN` or `DOWN,CLOSED,REFURBISHMENT` |
| Short waits only | `themeparks_live` | `max_wait=20` (or `min_wait`) |
| One ride: status, wait, return window, hourly forecast | `themeparks_live` | `entity="VelociCoaster"`; add `within` for shared names |
| Showtimes and ride hours today | `themeparks_live` | `include_times=true` |
| Park hours for a date range | `themeparks_schedule` | `from`, `days` (max 62), `type`, `include_purchases` for Lightning Lane prices |
| Ride uptime / breakdowns over recent days | `themeparks_uptime` | single ride: per-day `uptimePct`, `downMinutes`, wait stats |
| Which rides at a park broke down most | `themeparks_uptime` | `entity=<park>`, `sort=down_desc` (default), `days` (max 31) |

## Names

- `entity` takes a fuzzy name or an id. Resorts and parks resolve without help.
- `within=<park or resort>` is optional. Without it, ride names are searched across major resorts first, then everywhere (cached 6 hours). Pass `within` when you know the park; it is faster and avoids look-alikes.
- `themeparks_live` with a ride name shared by several parks ("Space Mountain") returns all of them, with `entity.type` `SAME_NAME_GROUP`. Say which park each line is.
- On `error: "ambiguous"`, pick from `candidates` (they carry `destination`) or ask the user which one.
- On `error: "not_found"`, follow `hint`.

## Reading results

- Status values are OPERATING, DOWN (temporarily stopped), CLOSED, REFURBISHMENT.
- `standbyWait` is minutes. `null` means no posted wait, not zero.
- `returnTime` is the free virtual queue / Lightning Lane window; `paidReturnTime` carries a price.
- `stale: true` means the park feed has not updated that item in over 24 hours. Say so.
- `uptimePct` is operating / (operating + down) inside published park hours. Today is partial.
- Keyless history reaches back 7 days. On `history_window_exceeded`, tell the user and mention the optional free key.
- On `rate_limited`, wait `retryAfterSeconds`; do not loop.

Cite ThemeParks.wiki as the source.

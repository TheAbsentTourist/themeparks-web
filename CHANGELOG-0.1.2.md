# themeparks-web 0.1.2

Same 4 tools; new abilities ride on modes and flags.

## Fixed
- `themeparks_schedule` on a resort returned no days: the month response nests hours under `parks[]`. Each entry now carries its `park`.
- With `within=<park>`, `entity.destination` showed the park name. Park and destination labels now come from the entity's own ids.
- Slugs and destination externalIds resolve in one call. Id-shaped text that does not resolve fails at once instead of scanning 161 destinations.

## Added
- Attribution: every result, including errors, carries `attribution` with the "Powered by ThemeParks.wiki" link; the skill tells the assistant to include it.
- `themeparks_uptime granularity=changes`: minute-level status intervals in park time, a wait timeline (min/max/time-weighted mean, each change), opening freshness (`observedAt`, `carriedInMinutes`, `degraded`). Ride: any range up to 31 days, park-local or RFC 3339 times. Park: one day, every span of a status (default DOWN) across all rides.
- `themeparks_uptime granularity=coverage`: how far back data exists per field.
- History budget: `historyBudget` from `RateLimit-History-*` headers when sent; otherwise a note. Keyless limits stated.
- Ride details: `entity.details` on a single-ride `themeparks_live`, and `include_details` on `themeparks_find` (attractionType, minimumHeight/maximumHeight in cm, mayGetWet, location, other tags).
- `bestTimeToRide`: today's lowest predicted wait window with crowd percentage (WDW and Disneyland Resort only; says so elsewhere). Forecast rows now include `percentage`.
- Optional `THEMEPARKS_API_KEY` features, all off without a key:
  - `themeparks_find mode=key_status`: plan, history window, both budgets from `/v1/me`; signup links when unset.
  - History windows follow `/v1/me` (free 30 days, paid plans longer, all-archive) instead of a fixed 7; daily ranges up to 3,660 days; park daily `next` pages followed (up to 15).
  - `themeparks_live mode=watch`: one bounded WebSocket session (preview protocol, auth frame, snapshot), collecting changes for up to 120 s or until `until_status` / `until_wait_at_most`. Needs a global WebSocket (Node 22+, or Node 20.10+ with `--experimental-websocket`).
- Manifest: `THEMEPARKS_API_KEY` marked `secret`, with the signup and key-page links.

## Unchanged
- Keyless behavior and the 4 tool names. Zero dependencies.

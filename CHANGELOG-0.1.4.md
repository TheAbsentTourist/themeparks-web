# themeparks-web 0.1.4

Audit fixes. The key stays optional. Results still carry `attribution`. No new runtime dependencies.

## Fixed

- All-resort search no longer turns a non-429 failure into `not_found` or a weak hit. The scan records `stoppedBy` and `retryAfterSeconds`. If nothing scanned, or the best score is below 0.9, the tool rethrows that error. A rate limit still returns a successful partial result with `scan.stoppedBy`.
- Parallel stdio calls no longer share one write. Responses are queued so one finishes before the next, and each response keeps the framing of its request.
- Memory cache entries expire at TTL plus a grace window (live 5 minutes past the 60-second TTL, history 30 minutes, children 1 hour, other data 15 minutes). HTTP 429, network errors, and 502/503/504 serve a cached answer only inside that window, marked `staleBecause`.
- Redirects are followed only when they stay on `https://api.themeparks.wiki` (at most 3 hops). A key is never sent to another host. A key containing CR, LF, or NUL is rejected with `bad_request` and is not echoed.
- Impossible calendar dates (`2026-02-31`) and clock times (`99:99`, `2026-13-01T00:00:00Z`) return `bad_request` instead of overflowing or `internal_error`.
- A daylight-saving gap (for example 2:30 AM on the spring-forward day in `America/New_York`) returns `bad_request`. A repeated hour sets `ambiguousNote` naming the offset used. Best time to ride buckets hours in the park's zone. When `/v1/me` supplies `historyEarliestDate`, the history window compares UTC dates.
- `mode=watch` finishes a snapshot only when a frame has `final: true`. If the timer wins first, the result sets `snapshotPartial: true`. One retryable error before subscribe resends the subscription; a second finishes with `watch_failed` and `retryAfterSeconds` is not waited out. `watch_seconds` above 120 is still clamped to 120. `until_status` and `until_wait_at_most` are OR: either match stops the watch.
- Park and destination daily history longer than 15 pages (31 days each, 465 days, 15 history calls) returns `bad_request` instead of a silently truncated rollup.
- After a direct `/entity/{id}` 404, a hyphenated name (no spaces) falls through to fuzzy search. Strings containing `;` or `=` still fail fast with no children scan.
- `retryAfter` is read from the top-level body field, then `error.retryAfter`, then the `Retry-After` header (seconds or HTTP-date). A process-wide budget (default 300 per 60 seconds, or the plan's limit) fails with `retryAfterSeconds` instead of sleeping. Over budget, a within-grace cached answer is served with `staleBecause: "rate_limited"`.
- `themeparks_uptime` `days` above the plan window is clamped and the result includes `note` stating the requested days, the allowed days, and the range returned. An explicit `from`/`to` past the window still returns `history_window_exceeded`.

- A destination `themeparks_schedule` result includes `parks` (`id` and `name` for each park) along with the per-day `park` label on each entry.
- A daylight-saving gap suggests the clock time after the jump (2:30 AM skipped in `America/New_York` suggests 3:30 AM EDT).

## Docs

README, the skill, PRIVACY, SECURITY, and TERMS match the behavior above: keyless history that includes today can lag live data by up to an hour; a park daily call can spend up to 15 history calls; watch works on Node 22+ or Node 20.10+ with `--experimental-websocket`.

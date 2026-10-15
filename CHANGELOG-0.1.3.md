# themeparks-web 0.1.3

## Fixed
- Name scoring has clear tiers: exact name or slug (1.0) > same words ignoring "park"/"resort" (0.97) > every word prefix-matched (0.80-0.95) > substring (0.7). Resort-ish queries ("resort", "world") get +0.02 on destinations. An exact match is ambiguous only against another exact match. `within:"Disneyland Resort"` no longer ties with Disneyland Paris's "Disneyland Park"; `"Disneyland Park"` (Anaheim and Paris) still asks which one.
- Same-name live groups (`"Space Mountain"`) format each item's `bestTimeToRide` in its own park's timezone; each item now carries `timezone`. Before, every item used the first response's zone (Magic Kingdom showed PDT).
- `themeparks_find within=<resort> type=PARK`: a park's `park` is itself and `destination` is the resort (it was the resort name in `park`). Listings now carry `destination`.

## Investigated: NightFlight Expedition, Oct 11, 4-6 PM ET
Raw `/history` returns the same 8 rows keyless and keyed, for the -04:00 instant range, the Z instant range, and the full day (`date=`). Opening state is DOWN (seen 9:09:52 AM). They match the daily summary (`firstOperatingAt` 20:07:29Z = 4:07:29 PM, 475 down minutes). The plugin's answer (DOWN to 4:07:29, OPERATING to 4:49:32, DOWN to 5:11:47, OPERATING to 6:00) is correct, and the live connector returns it too. The "OPERATING all 120 min, waits 80-140" report could not be reproduced with any argument form, and a 140-minute wait appears nowhere in that day's data. The likeliest source is a caller-side offset or a summary that didn't match the tool output. Changes:
- `zoneNote` when `from` carries an offset that isn't the park's, naming the park-time window actually read; `range.requested` echoes the args.
- `dataNote` and skill guidance: quote intervals and waits exactly, pass park-local times without an offset.
- Regression tests with the real rows (offline fixture and live smoke).

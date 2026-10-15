# VERIFY: themeparks-web 0.1.2

Run on 2026-10-15, about 11:07-11:09 AM ET, on Grok Bot's box (Linux, Node v20.19.2). All results below are real.

## Version sync
0.1.2 in `plugin.json`, `.cursor-plugin/plugin.json`, `package.json`, server `serverInfo` and User-Agent, skill, README, CHANGELOG-0.1.2.md, this file, and the zip name. `scripts/mcp-path-test.mjs` enforces it.

## Results

| Suite | Result |
|---|---|
| `node --check server.mjs` | PASS |
| Schemas (agent-plugins.org 1.0.0: plugin.json, mcp.json) | PASS |
| `npm run mcp-path` (spawn shape, variables declared, versions) | PASS |
| `npm run offline` (7 checks: 429, serve-stale, scan stop, key header) | PASS |
| `npm run offline-keyed` (14 checks: 0.1.2 fixes, timeline math, mocked /v1/me pro and all-archive plans, park daily paging, history budget headers, key_status, mock WebSocket watch, key never echoed) | PASS |
| `npm run smoke -- --keyed` live (44 keyless + 7 keyed with a real free-tier key) | 51/51 PASS |

Key handling during the run: the key was loaded from a mode-600 env file into the test process only. A search of the smoke log and samples for the key returned 0 matches.

Not live-proven (mocked only): plans above free (pro window, all-archive), park daily `next` paging (a 30-day park range came back in one page), watch close code 4029, and Node 22's built-in WebSocket (the live watch ran on Node 20 with `--experimental-websocket`).

## Live smoke log

```text
PASS initialize serverInfo :: themeparks-web 0.1.2
PASS tools/list exactly 4 tools :: themeparks_find, themeparks_live, themeparks_schedule, themeparks_uptime
PASS find Walt Disney World :: Walt Disney World® Resort e957da41-3552-4cf6-b636-5babc5cbc4e5
PASS find Universal Orlando :: Universal Orlando Resort 89db5d43-c434-4097-b71f-f6869f495a22
PASS find Space Mountain within WDW :: Space Mountain @ Magic Kingdom Park
PASS find Space Mountain with no within (all-resort search) :: 4 matches, scanned 23/161: Space Mountain @ Disneyland Park (1); Space Mountain @ Magic Kingdom Park (1); Hyperspace Mountain @ Hong Kong Disneyland Park (0.7); Star Wars Hyperspace Mountain @ Disneyland Park (0.7)
PASS find VelociCoaster with no within :: Jurassic World VelociCoaster @ Universal Islands of Adventure, scanned 23/161
PASS live VelociCoaster with no within :: OPERATING standby=30 lastUpdated=2026-10-15T14:15:17.904Z
PASS live Space Mountain with no within shows every same-name ride :: Magic Kingdom Park: OPERATING 20m; Disneyland Park: OPERATING 10m
PASS uptime Space Mountain with no within asks which one :: Disneyland Park vs Magic Kingdom Park
PASS find no args lists destinations :: 161 destinations
PASS find within Magic Kingdom type=RESTAURANT :: 23 restaurants
PASS live Magic Kingdom attractions sorted by wait :: counts={"OPERATING":32,"DOWN":0,"CLOSED":1,"REFURBISHMENT":3} top: TRON Lightcycle / Run=45m OPERATING; Seven Dwarfs Mine Train=40m OPERATING; Jungle Cruise=35m OPERATING; Peter Pan's Flight=35m OPERATING; The Many Adventures of Winnie the Pooh=30m OPERATING
PASS live Islands of Adventure attractions sorted by wait :: counts={"OPERATING":17,"DOWN":0,"CLOSED":5,"REFURBISHMENT":0} top: Flight of the Hippogriff™=80m OPERATING; Hagrid's Magical Creatures Motorbike Adventure™=80m OPERATING; Pteranodon Flyers=35m OPERATING; Skull Island: Reign of Kong=30m OPERATING; Jurassic World VelociCoaster=30m OPERATING
PASS live Universal Orlando status=DOWN,CLOSED :: counts={"OPERATING":51,"DOWN":1,"CLOSED":24,"REFURBISHMENT":0} DOWN: Hiccup's Wing Gliders (Universal Epic Universe)
PASS live Magic Kingdom max_wait=20 :: 17 rides at <=20m
PASS live single attraction Space Mountain :: OPERATING standby=20 lastUpdated=2026-10-15T15:02:46.054Z forecast=10h hours=3
PASS live 60s cache hit on repeat :: fetchedAt=2026-10-15T15:07:57.607Z
PASS schedule Magic Kingdom today+2 :: 2026-10-15: TICKETED_EVENT 07:30-08:00, OPERATING 08:00-18:00, TICKETED_EVENT 19:00-00:00 | 2026-10-16: TICKETED_EVENT 07:30-08:00, OPERATING 08:00-18:00, TICKETED_EVENT 19:00-00:00 | 2026-10-17: TICKETED_EVENT 07:30-08:00, OPERATING 08:00-23:00
PASS schedule Islands of Adventure type=OPERATING :: 2026-10-15 09:00-20:00 | 2026-10-16 09:00-20:00 | 2026-10-17 09:00-20:00
PASS schedule single ride falls back to live times :: No published schedule for this entity. Today's times from live data are shown instead.
PASS uptime Space Mountain last 7 days :: summary={"daysWithData":7,"uptimePct":96.2,"operatingMinutes":5453,"downMinutes":215,"worstDay":{"date":"2026-10-11","uptimePct":88.6,"downMinutes":106},"avgDailyMedianWait":37}
PASS uptime Magic Kingdom ranks rides by downtime :: Pirates of the Caribbean 51.1% (971m down); Tiana's Bayou Adventure 84.3% (312m down); Big Thunder Mountain Railroad 91.7% (164m down); TRON Lightcycle / Run 92.1% (157m down); Seven Dwarfs Mine Train 92.5% (156m down)
PASS uptime beyond keyless window -> history_window_exceeded :: Requests without an API key can see history back to 2026-10-09 (7 days). earliest=2026-10-09
PASS bad name -> not_found :: Nothing matches "Narnia World".
PASS unknown UUID -> upstream 404 not_found :: Entity 00000000-0000-0000-0000-000000000000 not found
PASS ambiguous name -> candidates :: Disneyland Park (Disneyland Paris) vs Disneyland Park (Disneyland Resort)
PASS bad flag value -> bad_request :: status must be one of OPERATING, DOWN, CLOSED, REFURBISHMENT; got BROKEN.
PASS every result carries Powered by ThemeParks.wiki :: [Powered by ThemeParks.wiki](https://themeparks.wiki)
PASS BUG1 destination schedule returns park entries :: 2 days, parks: Disney's Animal Kingdom Theme Park; Disney's Blizzard Beach Water Park; Disney's Hollywood Studios; EPCOT; Magic Kingdom Park
PASS BUG2 destination label correct when within is a park :: Magic Kingdom Park / Walt Disney World® Resort
PASS BUG3 slug resolves directly, no scan :: SeaWorld Parks and Resorts Orlando
PASS BUG3 unknown operator id fails fast, no scan :: 280 ms
PASS ride details (VelociCoaster minimumHeight 130 cm) :: {"attractionType":"RIDE","minimumHeight":130,"maximumHeight":null,"heightUnit":"cm","mayGetWet":null,"location":{"latitude":28.471429,"longitude":-81.472284}}
PASS best time to ride at WDW (forecast with percentage) :: Oct 15, 3:00:00 PM EDT - Oct 15, 5:00:00 PM EDT: 15m (12%)
PASS best time unavailable outside WDW/DLR says so :: ThemeParks.wiki publishes wait forecasts only for Walt Disney World and Disneyland Resort parks.
PASS history changes: NightFlight Expedition Oct 11 4-6 PM ET :: DOWN 4:00:00 PM EDT-4:07:29 PM EDT (7m); OPERATING 4:07:29 PM EDT-4:49:32 PM EDT (42m); DOWN 4:49:32 PM EDT-5:11:47 PM EDT (22m); OPERATING 5:11:47 PM EDT-6:00:00 PM EDT (48m) | waits 40-120m
PASS history changes: Magic Kingdom park-wide DOWN events Oct 11 :: 17 DOWN spans across 12 rides; worst Space Mountain 106m
PASS history changes: park range over a day -> bad_request :: A park-wide history covers one park-local day. Pass date=YYYY-MM-DD, or a range under a day.
PASS keyless coverage :: {"first":"2021-07-03","last":"2026-10-13"}
PASS key_status without key :: No THEMEPARKS_API_KEY is set. Everything works keyless: live, schedules, and 7 days of history at 60 history calls per hour. A key is optional.
PASS watch without key -> key_required :: Live push (mode=watch) needs THEMEPARKS_API_KEY. Without a key, call themeparks_live again to poll; data refreshes about once a minute.
PASS unexpanded ${THEMEPARKS_API_KEY} placeholder treated as no key :: keyless EPCOT lookup OK
PASS newline-delimited framing :: tools/list over LF
PASS KEYED key_status reads /v1/me :: free, 30d (earliest 2026-09-16), history 596/600/h, rest 299/300/min
PASS KEYED 30-day daily history with RateLimit-History budget :: 2026-09-16..2026-10-15 30 days uptime 95.3%, budget 595/600
PASS KEYED park daily 30 days :: 1 page(s); Big Thunder Mountain Railroad 89.9%; Pirates of the Caribbean 92.4%; Seven Dwarfs Mine Train 93.3%
PASS KEYED minute-level beyond 7 days :: 2026-09-25: {"OPERATING":894,"CLOSED":481,"DOWN":65}
PASS KEYED coverage :: {"entitiesWithData":109,"archiveFrom":"2021-07-03","recordedTo":"2026-10-13","retrievableThrough":"2026-10-15","measuredOn":"2026-10-15"}
PASS KEYED watch: WebSocket snapshot + updates :: limits={"maxConnections":1,"maxSubscriptions":1,"firehose":false} snapshot=36 updates=0 in 30s (time_limit)
PASS KEYED watch single ride stops when condition already met :: Space Mountain OPERATING after 1s

smoke: 51/51 PASS
```

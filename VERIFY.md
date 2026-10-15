# VERIFY: themeparks-web 0.1.3

Run on 2026-10-15, about 11:25 AM ET, on Grok Bot's box (Linux, Node v20.19.2). All results below are real.

## Version sync
0.1.3 in `plugin.json`, `.cursor-plugin/plugin.json`, `package.json`, server `serverInfo` and User-Agent, skill, README, CHANGELOG-0.1.3.md, this file, and the zip name. `scripts/mcp-path-test.mjs` enforces it.

## Results

| Suite | Result |
|---|---|
| `node --check server.mjs` | PASS |
| Schemas (agent-plugins.org 1.0.0: plugin.json, mcp.json) | PASS |
| `npm run mcp-path` | PASS |
| `npm run offline` (7) | PASS |
| `npm run offline-keyed` (14, mocked plans and WebSocket) | PASS |
| `npm run offline-regression` (6: scoring tiers, Disneyland Resort, PARK labels, per-item timezone, real NightFlight Oct 11 rows, foreign-offset note) | PASS |
| `npm run smoke -- --keyed` live (50 keyless + 7 keyed, real free-tier key) | 57/57 PASS |

## NightFlight Expedition, Oct 11, 4-6 PM ET
Raw `/history` gives the same 8 rows keyless and keyed, for the -04:00 instants, the Z instants, and `date=2026-10-11`. They agree with `/history/daily` (`firstOperatingAt` 20:07:29Z, 475 down minutes; the plugin's full-day intervals also total 475 DOWN). Answer: DOWN 4:00-4:07:29, OPERATING 4:07:29-4:49:32, DOWN 4:49:32-5:11:47, OPERATING 5:11:47-6:00 PM EDT; waits 40-120 min.

Not live-proven (mocked only): plans above free, park daily `next` paging, watch close code 4029, and Node 22's built-in WebSocket.

## Live smoke log

```text
PASS initialize serverInfo :: themeparks-web 0.1.3
PASS tools/list exactly 4 tools :: themeparks_find, themeparks_live, themeparks_schedule, themeparks_uptime
PASS find Walt Disney World :: Walt Disney World® Resort e957da41-3552-4cf6-b636-5babc5cbc4e5
PASS find Universal Orlando :: Universal Orlando Resort 89db5d43-c434-4097-b71f-f6869f495a22
PASS find Space Mountain within WDW :: Space Mountain @ Magic Kingdom Park
PASS find Space Mountain with no within (all-resort search) :: 4 matches, scanned 23/161: Space Mountain @ Disneyland Park (1); Space Mountain @ Magic Kingdom Park (1); Hyperspace Mountain @ Hong Kong Disneyland Park (0.7); Star Wars Hyperspace Mountain @ Disneyland Park (0.7)
PASS find VelociCoaster with no within :: Jurassic World VelociCoaster @ Universal Islands of Adventure, scanned 23/161
PASS live VelociCoaster with no within :: OPERATING standby=30 lastUpdated=2026-10-15T14:15:17.904Z
PASS live Space Mountain with no within shows every same-name ride :: Magic Kingdom Park: OPERATING 30m; Disneyland Park: OPERATING 10m
PASS uptime Space Mountain with no within asks which one :: Disneyland Park vs Magic Kingdom Park
PASS find no args lists destinations :: 161 destinations
PASS find within Magic Kingdom type=RESTAURANT :: 23 restaurants
PASS live Magic Kingdom attractions sorted by wait :: counts={"OPERATING":32,"DOWN":0,"CLOSED":1,"REFURBISHMENT":3} top: TRON Lightcycle / Run=40m OPERATING; Buzz Lightyear’s Space Ranger Spin=35m OPERATING; Seven Dwarfs Mine Train=35m OPERATING; The Many Adventures of Winnie the Pooh=30m OPERATING; Jungle Cruise=30m OPERATING
PASS live Islands of Adventure attractions sorted by wait :: counts={"OPERATING":17,"DOWN":0,"CLOSED":5,"REFURBISHMENT":0} top: Hagrid's Magical Creatures Motorbike Adventure™=80m OPERATING; Flight of the Hippogriff™=75m OPERATING; Pteranodon Flyers=40m OPERATING; Skull Island: Reign of Kong=30m OPERATING; Jurassic World VelociCoaster=30m OPERATING
PASS live Universal Orlando status=DOWN,CLOSED :: counts={"OPERATING":51,"DOWN":1,"CLOSED":24,"REFURBISHMENT":0} DOWN: Hiccup's Wing Gliders (Universal Epic Universe)
PASS live Magic Kingdom max_wait=20 :: 17 rides at <=20m
PASS live single attraction Space Mountain :: OPERATING standby=30 lastUpdated=2026-10-15T15:17:28.760Z forecast=10h hours=3
PASS live 60s cache hit on repeat :: fetchedAt=2026-10-15T15:18:41.621Z
PASS schedule Magic Kingdom today+2 :: 2026-10-15: TICKETED_EVENT 07:30-08:00, OPERATING 08:00-18:00, TICKETED_EVENT 19:00-00:00 | 2026-10-16: TICKETED_EVENT 07:30-08:00, OPERATING 08:00-18:00, TICKETED_EVENT 19:00-00:00 | 2026-10-17: TICKETED_EVENT 07:30-08:00, OPERATING 08:00-23:00
PASS schedule Islands of Adventure type=OPERATING :: 2026-10-15 09:00-20:00 | 2026-10-16 09:00-20:00 | 2026-10-17 09:00-20:00
PASS schedule single ride falls back to live times :: No published schedule for this entity. Today's times from live data are shown instead.
PASS uptime Space Mountain last 7 days :: summary={"daysWithData":7,"uptimePct":96.2,"operatingMinutes":5437,"downMinutes":215,"worstDay":{"date":"2026-10-11","uptimePct":88.6,"downMinutes":106},"avgDailyMedianWait":37}
PASS uptime Magic Kingdom ranks rides by downtime :: Pirates of the Caribbean 50.7% (971m down); Tiana's Bayou Adventure 84.1% (312m down); Big Thunder Mountain Railroad 91.7% (164m down); TRON Lightcycle / Run 92% (157m down); Seven Dwarfs Mine Train 92.4% (156m down)
PASS uptime beyond keyless window -> history_window_exceeded :: Requests without an API key can see history back to 2026-10-09 (7 days). earliest=2026-10-09
PASS bad name -> not_found :: Nothing matches "Narnia World".
PASS unknown UUID -> upstream 404 not_found :: Entity 00000000-0000-0000-0000-000000000000 not found
PASS ambiguous name -> candidates :: Disneyland Park (Disneyland Paris) vs Disneyland Park (Disneyland Resort)
PASS bad flag value -> bad_request :: status must be one of OPERATING, DOWN, CLOSED, REFURBISHMENT; got BROKEN.
PASS every result carries Powered by ThemeParks.wiki :: [Powered by ThemeParks.wiki](https://themeparks.wiki)
PASS BUG1 destination schedule returns park entries :: 2 days, parks: Disney's Animal Kingdom Theme Park; Disney's Blizzard Beach Water Park; Disney's Hollywood Studios; EPCOT; Magic Kingdom Park
PASS BUG2 destination label correct when within is a park :: Magic Kingdom Park / Walt Disney World® Resort
PASS BUG3 slug resolves directly, no scan :: SeaWorld Parks and Resorts Orlando
PASS BUG3 unknown operator id fails fast, no scan :: 421 ms
PASS ride details (VelociCoaster minimumHeight 130 cm) :: {"attractionType":"RIDE","minimumHeight":130,"maximumHeight":null,"heightUnit":"cm","mayGetWet":null,"location":{"latitude":28.471429,"longitude":-81.472284}}
PASS best time to ride at WDW (forecast with percentage) :: Oct 15, 3:00:00 PM EDT - Oct 15, 5:00:00 PM EDT: 15m (12%)
PASS best time unavailable outside WDW/DLR says so :: ThemeParks.wiki publishes wait forecasts only for Walt Disney World and Disneyland Resort parks.
PASS history changes: NightFlight Expedition Oct 11 4-6 PM ET :: DOWN 4:00:00 PM EDT-4:07:29 PM EDT (7m); OPERATING 4:07:29 PM EDT-4:49:32 PM EDT (42m); DOWN 4:49:32 PM EDT-5:11:47 PM EDT (22m); OPERATING 5:11:47 PM EDT-6:00:00 PM EDT (48m) | waits 40-120m
PASS history changes: Magic Kingdom park-wide DOWN events Oct 11 :: 17 DOWN spans across 12 rides; worst Space Mountain 106m
PASS history changes: park range over a day -> bad_request :: A park-wide history covers one park-local day. Pass date=YYYY-MM-DD, or a range under a day.
PASS keyless coverage :: {"first":"2021-07-03","last":"2026-10-13"}
PASS key_status without key :: No THEMEPARKS_API_KEY is set. Everything works keyless: live, schedules, and 7 days of history at 60 history calls per hour. A key is optional.
PASS watch without key -> key_required :: Live push (mode=watch) needs THEMEPARKS_API_KEY. Without a key, call themeparks_live again to poll; data refreshes about once a minute.
PASS 0.1.3 within "Disneyland Resort" resolves (not ambiguous) :: Disneyland Resort -> Space Mountain @ Disneyland Park
PASS 0.1.3 shared-name live uses each park's timezone :: MK Oct 15, 3:00:00 PM EDT (EDT); DL Oct 15, 8:00:00 AM PDT (PDT)
PASS 0.1.3 find PARKs within WDW: park=itself, destination=resort :: Disney's Animal Kingdom Theme Park; Disney's Blizzard Beach Water Park; Disney's Hollywood Studios; Disney's Typhoon Lagoon Water Park; EPCOT; Magic Kingdom Park
PASS 0.1.3 NightFlight 4-6 PM ET exact intervals (regression) :: DOWN 7,OPERATING 42,DOWN 22,OPERATING 48
PASS 0.1.3 NightFlight full-day rows agree with the 4-6 PM range :: day: {"CLOSED":643,"DOWN":475,"OPERATING":322}
PASS 0.1.3 foreign offset flagged with zoneNote :: from carried offset -07:00, but the park runs on -04:00. The range was read as Oct 11, 7:00:00 PM EDT to Oct 11, 9:00:00 PM EDT park time. For park-local hours pass times without an offset, e.g. 2026-10-11T16:00.
PASS unexpanded ${THEMEPARKS_API_KEY} placeholder treated as no key :: keyless EPCOT lookup OK
PASS newline-delimited framing :: tools/list over LF
PASS KEYED key_status reads /v1/me :: free, 30d (earliest 2026-09-16), history 577/600/h, rest 299/300/min
PASS KEYED 30-day daily history with RateLimit-History budget :: 2026-09-16..2026-10-15 30 days uptime 95.3%, budget 576/600
PASS KEYED park daily 30 days :: 1 page(s); Big Thunder Mountain Railroad 89.9%; Pirates of the Caribbean 92.4%; Seven Dwarfs Mine Train 93.3%
PASS KEYED minute-level beyond 7 days :: 2026-09-25: {"OPERATING":894,"CLOSED":481,"DOWN":65}
PASS KEYED coverage :: {"entitiesWithData":109,"archiveFrom":"2021-07-03","recordedTo":"2026-10-13","retrievableThrough":"2026-10-15","measuredOn":"2026-10-15"}
PASS KEYED watch: WebSocket snapshot + updates :: limits={"maxConnections":1,"maxSubscriptions":1,"firehose":false} snapshot=36 updates=1 in 30s (time_limit)
PASS KEYED watch single ride stops when condition already met :: Space Mountain OPERATING after 1s

smoke: 57/57 PASS
```

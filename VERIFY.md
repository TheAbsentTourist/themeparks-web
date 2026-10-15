# VERIFY: themeparks-web 0.1.1

Run date: Thursday 2026-10-15, about 10:51 AM EDT (live calls at 14:51 UTC). Orlando parks open.

Target host: Grok Bot (local stdio MCP connector). Agent Plugin format.

## Version sync

0.1.1 in `plugin.json`, `.cursor-plugin/plugin.json`, `package.json`, server `serverInfo` and User-Agent, skill, README, CHANGELOG-0.1.1.md, this file, and the zip name. `scripts/mcp-path-test.mjs` enforces it.

## PASS/FAIL

| Check | Result |
|---|---|
| `plugin.json` vs agent-plugins.org 1.0.0 schema (workspace and installed) | PASS |
| `mcp.json` vs agent-plugins.org 1.0.0 schema (workspace and installed) | PASS |
| Root `plugin.json` has no `logo` | PASS |
| Every `${VAR}` in `mcp.json` declared in manifest variables (`THEMEPARKS_API_KEY`, optional) | PASS |
| `assets/logo-plate.png` 1024x1024 RGB opaque, inspected visually | PASS |
| `package.json` `private: false`, repository, bugs, homepage | PASS |
| `node --check server.mjs` (workspace and installed) | PASS |
| `scripts/mcp-path-test.mjs` | PASS |
| `scripts/offline-test.mjs` (7 checks incl. serve-stale on 429 after TTL expiry, search stop on 429) | PASS 7/7 |
| `scripts/smoke.mjs` live, workspace | PASS 30/30 |
| `scripts/smoke.mjs` live, installed copy | PASS 30/30 |
| Connector-shape run: `node /home/box/.cursor/plugins/local/themeparks-web/server.mjs` from cwd `/`, empty env, LF framing, `themeparks_live {"entity":"VelociCoaster"}` | PASS |
| Workspace vs installed MD5 | PASS (identical) |
| Local git repo, 1 commit, author TheAbsentTourist noreply | PASS |
| Live 429 from the real API | NOT PROVEN live; simulated in offline test |
| Added as a Grok Bot connector | NOT DONE in this run; needs the host's add-connector action |

## No-within samples (14:51 UTC / 10:51 AM EDT)

- `themeparks_find {"query":"Space Mountain"}` scanned 23 of 161 destinations: Space Mountain @ Disneyland Park (1.0), Space Mountain @ Magic Kingdom Park (1.0), Hyperspace Mountain @ Hong Kong Disneyland Park (0.7), Star Wars Hyperspace Mountain @ Disneyland Paris (0.7).
- `themeparks_find {"query":"VelociCoaster"}` scanned 23 of 161: Jurassic World VelociCoaster @ Universal Islands of Adventure (0.85).
- `themeparks_live {"entity":"VelociCoaster"}`: OPERATING, standby 30 min, return window TEMP_FULL, lastUpdated 14:15:17 UTC.
- `themeparks_live {"entity":"Space Mountain"}`: SAME_NAME_GROUP. Magic Kingdom OPERATING 25 min (lastUpdated 14:47:47 UTC). Disneyland Park CLOSED (7:51 AM in Anaheim).
- `themeparks_uptime {"entity":"Space Mountain"}`: `ambiguous`, candidates Disneyland Park vs Magic Kingdom Park.

## Other live samples

- Magic Kingdom top waits: TRON 60, Jungle Cruise 45, Seven Dwarfs 40, Winnie the Pooh 35, Tiana's 35.
- Islands of Adventure: Flight of the Hippogriff 80, Hagrid's 80, Pteranodon Flyers 35, VelociCoaster 30.
- Universal Orlando DOWN: Caro-Seuss-el (Islands of Adventure), Hiccup's Wing Gliders (Epic Universe).
- Space Mountain (Magic Kingdom) uptime Oct 9 to 15: 96.2% (5,437 up, 215 down minutes).
- Magic Kingdom most downtime Oct 13 to 15: Pirates of the Caribbean 50.7% (971 min down), Tiana's Bayou Adventure 84.1%, Big Thunder 91.7%.

## Install

```bash
rm -rf ~/.cursor/plugins/local/themeparks-web
cp -a /workspace/themeparks-web ~/.cursor/plugins/local/themeparks-web
```

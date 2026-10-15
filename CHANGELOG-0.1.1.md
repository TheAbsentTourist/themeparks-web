# CHANGELOG 0.1.1

Submission polish, targeting Grok Bot.

- Ride, show, and restaurant names now resolve without `within`. The server searches major resorts first (about 23 calls on a cold cache), then every destination only if nothing matched. Resort entity lists are cached for 6 hours. A 429 during the search stops it cleanly and reports `scan.stoppedBy`.
- `themeparks_live` with a name several parks share ("Space Mountain") returns every match as a `SAME_NAME_GROUP` instead of an error. Other tools still return `ambiguous` with candidates.
- Entity headers now carry `destination`.
- Offline test now proves serve-stale-on-429 (clock advanced past the 60 s TTL) and the search's 429 stop. Live smoke grew from 25 to 30 checks.
- Docs: TERMS.md, PRIVACY.md, SECURITY.md, this changelog. README credits ThemeParks.wiki and lists known limits.
- `assets/logo-plate.png`: 1024x1024 opaque RGB (castle, coaster, clock). Referenced from `.cursor-plugin/plugin.json` only. The root `plugin.json` schema forbids `logo`.
- `package.json`: `private: false`, repository, bugs, homepage, files.
- `mcp-path-test.mjs` now checks that every `${VAR}` in `mcp.json` is declared in manifest variables, and drops the Cursor-on-Windows cwd rule.
- Version 0.1.1 synced.

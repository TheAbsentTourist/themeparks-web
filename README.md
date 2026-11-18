# themeparks-web

<p align="center">
  <img src="assets/logo-plate.png" alt="themeparks-web" width="160" height="160" />
</p>

Live theme park data for Grok Bot: ride status, wait times, virtual queues, park hours, best time to ride, and ride downtime history.

This repo is a **plugin**, not a website. Agents call it as a stdio MCP server (`server.mjs`). Zero npm dependencies. Node.js 18+. MIT.

**Powered by [ThemeParks.wiki](https://themeparks.wiki).** Unofficial; not affiliated with ThemeParks.wiki or any park. See [TERMS.md](TERMS.md), [PRIVACY.md](PRIVACY.md), and [SECURITY.md](SECURITY.md).

**Repo:** [github.com/TheAbsentTourist/themeparks-web](https://github.com/TheAbsentTourist/themeparks-web) · **Author:** [TheAbsentTourist](https://github.com/TheAbsentTourist) · chucktastictime@gmail.com

---

## What you get

| You want | Tool |
|----------|------|
| Find a resort, park, or ride by name | `themeparks_find` |
| Live status, waits, virtual queues, best time to ride | `themeparks_live` |
| Park hours and special events | `themeparks_schedule` |
| Downtime history and daily uptime % | `themeparks_uptime` |

Every tool works with **no API key**. An optional free key adds more history and live push (see below).

---

## Install (Grok Bot)

Requires **Node.js 18+** and `npx` on `PATH`. There is no local path and no working-directory setting. Any host that can run `npx`, including the Grok Bot Directory, uses this block as written:

```json
{
  "mcpServers": {
    "themeparks-web": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "github:TheAbsentTourist/themeparks-web"],
      "env": {
        "THEMEPARKS_API_KEY": "${THEMEPARKS_API_KEY}"
      }
    }
  }
}
```

`npx -y github:TheAbsentTourist/themeparks-web` installs this package from GitHub and runs the `themeparks-web` bin (`server.mjs`). Leave `THEMEPARKS_API_KEY` blank to stay keyless. If a host leaves `${THEMEPARKS_API_KEY}` unexpanded, or sets it to a blank string, the server treats that value as unset and does not send it as a key.

Live push (`themeparks_live` `mode=watch`) needs Node.js 22+, or Node.js 20.10+ with `--experimental-websocket`. The npx command does not pass that flag.

---

## Optional API key

Set `THEMEPARKS_API_KEY` in the connector's environment. Get one free: [register](https://www.themeparks.wiki/register), then generate a key on your [profile](https://www.themeparks.wiki/profile). It's sent only to `api.themeparks.wiki` and never logged.

| | No key | Free key |
|---|---|---|
| History window | 7 days | 30 days (paid plans longer) |
| History calls | 60 / hour | 600 / hour |
| `themeparks_find mode=key_status` | Signup links | Plan and budgets |
| `themeparks_live mode=watch` (live push, up to 120 s) | — | Yes (Node 22+, or 20.10+ with `--experimental-websocket`) |

---

## Known limits

- **A few minutes behind.** Data comes from the parks' apps via ThemeParks.wiki and refreshes about once a minute.
- **Rate limits.** 300 requests a minute per IP across all tools. When it's hit, the tool returns `retryAfterSeconds` (or a recent cached answer marked `staleBecause`).
- **Best time to ride** uses ThemeParks.wiki's forecast, which only exists for Walt Disney World and Disneyland Resort.
- **Watch mode is short.** For "tell me when it reopens," pair it with a scheduled routine.
- **No hosting.** ThemeParks.wiki's terms forbid republishing the data as an API, so this runs locally per user. Answers must keep the "Powered by ThemeParks.wiki" credit.

Every response includes `fetchedAt`, and live items include `lastUpdated` so you can tell how fresh they are.

---

## Verify

```bash
npm run check      # syntax
npm run offline    # offline tests (also offline-keyed, offline-regression, offline-audit)
npm run smoke      # live keyless checks (add --keyed with a key set)
```

Version 0.1.5. Latest recorded run: [VERIFY.md](VERIFY.md) · [CHANGELOG-0.1.5.md](CHANGELOG-0.1.5.md).

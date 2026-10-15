# themeparks-web

<p align="center">
  <img src="assets/logo-plate.png" alt="themeparks-web" width="160" height="160" />
</p>

Live theme park data for Cursor (and other MCP hosts): ride status, wait times, virtual queues, park hours, best time to ride, and ride downtime history.

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

## Install

1. Install **Node.js 18+** from [nodejs.org](https://nodejs.org).
2. Clone into Cursor's local plugins folder as a real directory (no symlink):

```bash
git clone https://github.com/TheAbsentTourist/themeparks-web.git ~/.cursor/plugins/local/themeparks-web
```

Windows PowerShell:

```powershell
git clone https://github.com/TheAbsentTourist/themeparks-web.git $env:USERPROFILE\.cursor\plugins\local\themeparks-web
```

3. Reload Cursor (**Developer: Reload Window**) and check Plugins for **themeparks-web**.

### Windows: if the server won't start

Cursor on Windows currently launches plugin MCP servers from the wrong folder and sometimes without Node on PATH. Logs show `Cannot find module '...\server.mjs'` or `spawn node ENOENT`. Add this to `%USERPROFILE%\.cursor\mcp.json` with your real paths (keep any other servers):

```json
{
  "mcpServers": {
    "themeparks-web": {
      "command": "C:\\Program Files\\nodejs\\node.exe",
      "args": ["C:\\Users\\USERNAME\\.cursor\\plugins\\local\\themeparks-web\\server.mjs"]
    }
  }
}
```

If logs still name `plugin-themeparks-web-themeparks-web`, put the same paths in the plugin's own `mcp.json`. Never commit these paths.

### Grok Bot

Add a stdio connector named `themeparks-web`: command `node`, args `["<plugin folder>/server.mjs"]`. On Node 20, add `--experimental-websocket` before the script path so live push works.

---

## Optional API key

Set `THEMEPARKS_API_KEY` in **Plugins → Configure** (or the host environment). Get one free: [register](https://www.themeparks.wiki/register), then generate a key on your [profile](https://www.themeparks.wiki/profile). It's sent only to `api.themeparks.wiki` and never logged.

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

Latest recorded run: [VERIFY.md](VERIFY.md).

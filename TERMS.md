# Terms and attribution: themeparks-web

This plugin is unofficial software. It is not affiliated with, endorsed by, or approved by ThemeParks.wiki, The Walt Disney Company, Universal Destinations & Experiences, SeaWorld, Six Flags, Merlin, or any other park operator. Park and ride names are trademarks of their owners and appear only to identify the data.

## Upstream source

| Source | Use | Notes |
|--------|-----|-------|
| [ThemeParks.wiki API v1](https://www.themeparks.wiki/api) (`api.themeparks.wiki/v1`) | Destinations, entities, live status and waits, schedules, daily history summaries | Free, including commercial use per ThemeParks.wiki. Data is collected from the parks' own apps and is unofficial. Credit ThemeParks.wiki when you show it. |

## Limits this plugin respects

- 300 requests per minute per IP (shared by every tool), 60 history calls per hour without a key.
- Live data is cached for 60 seconds, the same cadence the API updates. Other data is cached for 5 minutes, and resort entity lists for 6 hours.
- On HTTP 429 the plugin stops, reports `retryAfterSeconds`, and serves an older cached answer when it has one. It never retries in a loop.

## Secrets

`THEMEPARKS_API_KEY` is optional and supplied by the user through manifest variables or the environment. The plugin never ships, invents, or hard-codes a key.

## No warranty

Wait times, ride status, and hours can be late, wrong, or missing. A ride can show DOWN a few minutes after it actually stops. Check the park's official app before acting on the data. The plugin is provided "as is" without warranty of any kind. See [LICENSE](LICENSE).

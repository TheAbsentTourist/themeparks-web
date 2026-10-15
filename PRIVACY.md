# Privacy policy

themeparks-web is an unofficial third-party plugin. It is not affiliated with ThemeParks.wiki or any park operator.

## What this plugin does

The plugin runs on the installer's machine. It has no backend operated by the plugin author. When a tool is called, it sends HTTPS requests from that machine directly to `api.themeparks.wiki`.

## What is sent upstream

- The park, resort, or entity ids and date ranges needed to answer the request. A name that contains a space is matched locally and is not sent. A UUID, a slug, or any other id-shaped string (no spaces) is sent as the path of `GET /v1/entity/{id}`. If that lookup 404s, a name search continues locally and only the resolved id is sent.
- An identifying User-Agent (`ThemeParksWebPlugin/<version>` with a contact email).
- Your `THEMEPARKS_API_KEY` as the `x-api-key` header, only when you set one, and only to `api.themeparks.wiki`. Redirects are followed only when they stay on that host, so the key is not sent elsewhere. With `themeparks_live mode=watch`, the same key goes in the first WebSocket frame to `wss://api.themeparks.wiki/v1/live`; the socket closes before the tool returns. The key is never logged and never included in a tool result.

No location, account, or personal data is sent.

## Credentials

The optional key stays on your machine. It is never sent to the plugin author and must not be committed to git.

## Data

- No analytics, telemetry, or tracking.
- Responses are cached in memory only and discarded when the server exits.
- The plugin does not sell data or use your queries to train models.

ThemeParks.wiki applies its own privacy policy to the requests your machine sends it.

## Contact

chucktastictime@gmail.com. Issues: https://github.com/TheAbsentTourist/themeparks-web/issues

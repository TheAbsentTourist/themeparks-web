# Privacy policy

themeparks-web is an unofficial third-party plugin. It is not affiliated with ThemeParks.wiki or any park operator.

## What this plugin does

The plugin runs on the installer's machine. It has no backend operated by the plugin author. When a tool is called, it sends HTTPS requests from that machine directly to `api.themeparks.wiki`.

## What is sent upstream

- The park, resort, or entity ids and date ranges needed to answer the request. Free-text names are matched locally and are not sent.
- An identifying User-Agent (`ThemeParksWebPlugin/<version>` with a contact email).
- Your `THEMEPARKS_API_KEY` as the `x-api-key` header, only when you set one, and only to `api.themeparks.wiki`.

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

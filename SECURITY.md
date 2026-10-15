# Security

Report vulnerabilities to chucktastictime@gmail.com or via GitHub issues: https://github.com/TheAbsentTourist/themeparks-web/issues

Do not include a `THEMEPARKS_API_KEY` in a report. If a key leaks, rotate it from your ThemeParks.wiki account. The server never logs the key or includes it in a tool result.

The plugin is read-only. It makes GET requests to one host (`api.themeparks.wiki`), stores nothing on disk, has no dependencies beyond Node 18+, and keeps credentials on the installer machine.

HTTP redirects are followed only when the next URL is `https://api.themeparks.wiki` (at most three hops). A redirect to any other host is refused, and the key is not sent there. A key containing a carriage return, line feed, or NUL byte is rejected before it is placed on a request.

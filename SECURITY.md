# Security

Report vulnerabilities to chucktastictime@gmail.com or via GitHub issues: https://github.com/TheAbsentTourist/themeparks-web/issues

Do not include a `THEMEPARKS_API_KEY` in a report. If a key leaks, rotate it from your ThemeParks.wiki account.

The plugin is read-only. It makes GET requests to one host (`api.themeparks.wiki`), stores nothing on disk, has no dependencies beyond Node 18+, and keeps credentials on the installer machine.

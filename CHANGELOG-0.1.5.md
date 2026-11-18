# CHANGELOG 0.1.5

Shipped `mcp.json` now launches with `npx -y github:TheAbsentTourist/themeparks-web` and no `cwd` or local paths, so a directory validator can run the setup as written. `package.json` adds a `themeparks-web` bin (`server.mjs`, executable) and a `files` list (`server.mjs`, `skills`, `assets`, `LICENSE`, `README.md`). Blank and unexpanded `${THEMEPARKS_API_KEY}` values are treated as unset instead of as an API key. The server does not locate package files with `process.cwd()`. Version 0.1.5.

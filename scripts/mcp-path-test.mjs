#!/usr/bin/env node
/** Offline checks: portable mcp.json spawn shape, variables match env placeholders, versions in sync. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");
const mcpRaw = read("mcp.json");
const server = JSON.parse(mcpRaw).mcpServers?.["themeparks-web"];

assert.ok(server, "themeparks-web server missing from mcp.json");
assert.equal(server.type, "stdio");
assert.equal(server.command, "node");
assert.deepEqual(server.args, ["./server.mjs"]);
assert.match(server.cwd, /^(\.\/|\$\{PLUGIN_ROOT\}(\/|$))/, "cwd must be plugin-relative");
assert.doesNotMatch(mcpRaw, /C:\\\\Users|Program Files|\/home\//i);
assert.equal(server.env?.THEMEPARKS_API_KEY, "${THEMEPARKS_API_KEY}");
const placeholders = [...mcpRaw.matchAll(/\$\{([A-Z][A-Z0-9_]*)\}/g)].map((m) => m[1]).filter((v) => v !== "PLUGIN_ROOT" && v !== "PLUGIN_DATA");

const cursor = JSON.parse(read(".cursor-plugin/plugin.json"));
const agent = JSON.parse(read("plugin.json"));
assert.equal(cursor.mcpServers, "./mcp.json");
for (const v of placeholders) assert.ok(cursor.variables.properties[v], `\${${v}} in mcp.json must be declared in manifest variables`);
assert.ok(!cursor.variables.required?.length, "the key is optional; no required variables");
assert.equal(agent.logo, undefined, "root plugin.json must not carry logo (schema additionalProperties:false)");
assert.equal(cursor.logo, "assets/logo-plate.png");
assert.equal(JSON.parse(read("package.json")).private, false);

const version = agent.version;
assert.equal(cursor.version, version);
assert.equal(JSON.parse(read("package.json")).version, version);
assert.match(read("server.mjs"), new RegExp(`const VERSION = "${version}"`));
for (const doc of ["README.md", "VERIFY.md", "skills/themeparks-web/SKILL.md", `CHANGELOG-${version}.md`]) {
  assert.match(read(doc), new RegExp(version.replace(/\./g, "\\.")), `${doc} must mention ${version}`);
}
console.log(`mcp-path-test: PASS (version ${version})`);

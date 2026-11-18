#!/usr/bin/env node
/**
 * Offline checks: portable mcp.json spawn shape, variables match env placeholders, versions in sync.
 *
 * Public mcp.json must stay portable:
 *   command npx (uvx, bunx, docker, node, or cmd.exe also accepted as portable)
 *   args without machine-absolute paths, local relative paths, or blanks
 *   no ${PLUGIN_ROOT}
 *   no cwd — npx does not launch from the plugin folder
 */
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

const portableCommands = new Set(["npx", "uvx", "bunx", "docker", "node", "cmd.exe"]);
assert.ok(
  portableCommands.has(server.command),
  `command must be portable (npx, uvx, bunx, docker, node, or cmd.exe), got ${JSON.stringify(server.command)}`,
);
assert.equal(server.command, "npx");
assert.deepEqual(server.args, ["-y", "github:TheAbsentTourist/themeparks-web"]);
assert.equal(server.cwd, undefined, "shipped mcp.json must not set cwd");
assert.doesNotMatch(String(server.command), /\$\{PLUGIN_ROOT\}/);
assert.doesNotMatch(mcpRaw, /C:\\\\Users|Program Files|\/home\//i);
assert.notEqual(server.command, "./scripts/run-mcp.cmd");
assert.equal(server.env?.THEMEPARKS_API_KEY, "${THEMEPARKS_API_KEY}");

const args = server.args ?? [];
for (const arg of args) {
  const text = String(arg);
  assert.doesNotMatch(text, /C:\\Users/i, "args must not contain C:\\Users (user mcp.json only)");
  assert.doesNotMatch(text, /Program Files/i, "args must not contain Program Files");
  assert.doesNotMatch(text, /\$\{PLUGIN_ROOT\}/, "do not put ${PLUGIN_ROOT} in args");
  assert.notEqual(text.trim(), "", "args must not contain blanks");
  assert.doesNotMatch(text, /^\.\.?[/\\]/, "args must not be local paths");
}
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

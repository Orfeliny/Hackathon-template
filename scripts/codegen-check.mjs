// Fails when `convex/_generated` is out of date. Needs a Convex deployment
// (`convex codegen` refuses to run without one), so it is a local/lane check, not a CI one.
import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const generatedDir = process.argv[2] ?? join("convex", "_generated");

/** @param {string} dir @returns {Map<string, string>} */
function snapshot(dir) {
  /** @type {Map<string, string>} */
  const files = new Map();
  if (!existsSync(dir)) return files;
  for (const name of readdirSync(dir).sort()) {
    files.set(
      name,
      readFileSync(join(dir, name), "utf8").replaceAll("\r\n", "\n"),
    );
  }
  return files;
}

const backup = mkdtempSync(join(tmpdir(), "codegen-check-"));
const before = snapshot(generatedDir);
if (existsSync(generatedDir)) cpSync(generatedDir, backup, { recursive: true });

// anonymous mode lets a clone without a configured deployment use a local backend
const convexBin = join("node_modules", "convex", "bin", "main.js");
const result = spawnSync(process.execPath, [convexBin, "codegen"], {
  stdio: ["ignore", "inherit", "inherit"],
  env: { CONVEX_AGENT_MODE: "anonymous", ...process.env },
});

if (result.status !== 0) {
  rmSync(backup, { recursive: true, force: true });
  console.error(
    "\ncodegen:check could not run `convex codegen` (see output above).\n" +
      "It needs a configured Convex deployment: run `npx convex dev --once` once to set one up.",
  );
  process.exit(2);
}

const after = snapshot(generatedDir);
const changed = [...new Set([...before.keys(), ...after.keys()])]
  .filter((name) => before.get(name) !== after.get(name))
  .sort();

if (changed.length > 0) {
  // restore so the check stays idempotent: a second run must fail too until the fix is committed
  rmSync(generatedDir, { recursive: true, force: true });
  cpSync(backup, generatedDir, { recursive: true });
}
rmSync(backup, { recursive: true, force: true });

if (changed.length > 0) {
  console.error(
    `\nconvex/_generated is stale. Differing files:\n${changed.map((f) => `  - ${f}`).join("\n")}\n` +
      "Run `npx convex codegen` and commit the result.",
  );
  process.exit(1);
}

console.log("convex/_generated is up to date.");

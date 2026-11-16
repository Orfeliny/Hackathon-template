// CI check for the contract-first rule: hot and normal files must not share a PR (ARCH 14.3).
import { spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { classify, loadHotFiles } from "./lib/hot-files.mjs";

/** The PR template (task 24) must contain exactly this line. */
export const ACK_TEXT = "Zmiana plików wspólnych uzgodniona z zespołem";

const ACK_PATTERN = new RegExp(
  `^[ \\t]*[-*][ \\t]+\\[[xX]\\][ \\t]+${ACK_TEXT}[ \\t]*$`,
  "mu",
);

/** @param {string} body */
export const isAcknowledged = (body) => ACK_PATTERN.test(body);

/**
 * @param {{ files: string[], body: string, patterns: string[] }} input
 * @returns {{ ok: boolean, message: string, hot: string[], normal: string[] }}
 */
export function evaluate({ files, body, patterns }) {
  const hot = [];
  const normal = [];
  for (const file of files) {
    const level = classify(file, patterns);
    if (level === "hot") hot.push(file);
    else if (level === "normal") normal.push(file);
  }
  if (hot.length === 0 || normal.length === 0)
    return { ok: true, message: "No hot/normal mix.", hot, normal };
  if (isAcknowledged(body))
    return {
      ok: true,
      message: "Mixed PR, acknowledged in the PR body.",
      hot,
      normal,
    };
  return {
    ok: false,
    message: [
      "This PR mixes hot files with feature files (contract-first rule).",
      "Split it into a contract PR and a feature PR, or tick the box",
      `"- [x] ${ACK_TEXT}" in the PR description and press "Re-run failed jobs".`,
      `Hot: ${hot.join(", ")}`,
      `Normal: ${normal.join(", ")}`,
    ].join("\n"),
    hot,
    normal,
  };
}

/**
 * @param {string} command @param {string[]} args
 * @returns {string}
 */
function run(command, args) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(result.stderr || `${command} exited ${result.status}`);
  return result.stdout;
}

/** @param {NodeJS.ProcessEnv} env */
export function main(env) {
  const { PR_NUMBER, BASE_SHA, HEAD_SHA } = env;
  if (!PR_NUMBER || !BASE_SHA || !HEAD_SHA) {
    console.error("PR_NUMBER, BASE_SHA and HEAD_SHA are required.");
    return 2;
  }
  const patterns = loadHotFiles(
    fileURLToPath(new URL("../.github/hot-files.txt", import.meta.url)),
  );
  const files = run("git", [
    "-c",
    "core.quotepath=off",
    "diff",
    "--name-only",
    `${BASE_SHA}...${HEAD_SHA}`,
  ])
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");
  const body = JSON.parse(
    run("gh", ["pr", "view", PR_NUMBER, "--json", "body"]),
  ).body;
  const result = evaluate({ files, body: body ?? "", patterns });
  (result.ok ? console.log : console.error)(result.message);
  return result.ok ? 0 : 1;
}

const entry = process.argv[1];
if (
  entry &&
  realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url))
) {
  try {
    process.exitCode = main(process.env);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 2;
  }
}

// Prepares production deploys for a repo created from the template: Convex project + deploy key,
// Vercel link, and the four `production` environment secrets in GitHub. See docs/deployment.md.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { CONVEX_BIN } from "./lib/proc.mjs";

const SECRETS = [
  "CONVEX_DEPLOY_KEY",
  "VERCEL_TOKEN",
  "VERCEL_ORG_ID",
  "VERCEL_PROJECT_ID",
];
const ENVIRONMENT = "production";
const SAFE_NAME = /^[A-Za-z0-9._-]+$/;
const DEPLOY_KEY = /^prod:[^|\s]+\|\S+$/;

export const RULESET_NAME = "main protection (setup:deploy)";

/** Ruleset on `main` as in docs/deployment.md (ARCH 10.3). Exact ref, no wildcard: merge queue needs it. */
export function rulesetPayload() {
  return {
    name: RULESET_NAME,
    target: "branch",
    enforcement: "active",
    conditions: { ref_name: { include: ["refs/heads/main"], exclude: [] } },
    rules: [
      { type: "deletion" },
      { type: "non_fast_forward" },
      {
        type: "pull_request",
        parameters: {
          required_approving_review_count: 0,
          dismiss_stale_reviews_on_push: false,
          require_code_owner_review: false,
          require_last_push_approval: false,
          required_review_thread_resolution: false,
          allowed_merge_methods: ["squash"],
        },
      },
      {
        type: "required_status_checks",
        parameters: {
          strict_required_status_checks_policy: false,
          required_status_checks: [{ context: "gate" }],
        },
      },
      {
        type: "merge_queue",
        parameters: {
          check_response_timeout_minutes: 60,
          grouping_strategy: "ALLGREEN",
          max_entries_to_build: 5,
          max_entries_to_merge: 5,
          merge_method: "SQUASH",
          min_entries_to_merge: 1,
          min_entries_to_merge_wait_minutes: 5,
        },
      },
    ],
  };
}

class SetupError extends Error {}

/**
 * @typedef {{ status: number, stdout: string, stderr: string }} RunResult
 * @typedef {(command: string, args: string[], options?: { input?: string }) => RunResult} Run
 * @typedef {{
 *   run: Run,
 *   log: (line: string) => void,
 *   confirm: (question: string) => Promise<boolean>,
 *   readSecret: (prompt: string) => Promise<string>,
 *   readFile: (path: string) => string | null,
 *   nodeVersion: string,
 * }} Deps
 */

/** @param {string[]} argv */
export function parseArgs(argv) {
  const flags = new Set(argv);
  const known = new Set(["--dry-run", "--protect", "--yes"]);
  const unknown = argv.filter((a) => !known.has(a));
  if (unknown.length > 0)
    throw new SetupError(
      `Nieznana opcja: ${unknown.join(", ")}. Dostępne: --dry-run, --protect, --yes.`,
    );
  return {
    dryRun: flags.has("--dry-run"),
    protect: flags.has("--protect"),
    yes: flags.has("--yes"),
  };
}

/** @param {string} yml */
export function pinnedVercel(yml) {
  const match = /vercel@(\d+\.\d+\.\d+)/.exec(yml);
  if (!match)
    throw new SetupError("Nie znaleziono wersji vercel w deploy.yml.");
  return match[1];
}

/** @param {string | null} envLocal */
export function hasCloudDeployment(envLocal) {
  if (!envLocal) return false;
  const line = envLocal
    .split(/\r?\n/)
    .find((l) => /^\s*CONVEX_DEPLOYMENT\s*=/.test(l));
  if (!line) return false;
  const value = line
    .slice(line.indexOf("=") + 1)
    .replace(/#.*/, "")
    .trim()
    .replace(/^["']|["']$/g, "");
  return value !== "" && !/^(local|anonymous)[:-]/.test(value);
}

/**
 * @param {string[]} argv
 * @param {Deps} deps
 * @returns {Promise<number>} exit code
 */
export async function runSetup(argv, deps) {
  const { log, run } = deps;
  /** @type {string[]} */
  const secretValues = [];
  const scrub = (/** @type {string} */ text) =>
    secretValues.reduce(
      (out, secret) => (secret ? out.split(secret).join("***") : out),
      text,
    );
  const fail = (/** @type {string} */ message) => {
    throw new SetupError(scrub(message));
  };
  /** @type {(label: string, command: string, args: string[], options?: { input?: string }) => RunResult} */
  const must = (label, command, args, options) => {
    const result = run(command, args, options);
    if (result.status !== 0)
      fail(
        `${label} nie powiodło się: ${result.stderr.trim() || "brak komunikatu"}`,
      );
    return result;
  };

  try {
    const options = parseArgs(argv);
    const { dryRun } = options;
    const plan = (/** @type {string} */ line) =>
      log(dryRun ? `[dry-run] ${line}` : line);

    if (Number(deps.nodeVersion.replace(/^v/, "").split(".")[0]) !== 24)
      fail(
        `Potrzebny Node 24 (jest ${deps.nodeVersion}). Uruchom \`fnm use\` albo \`nvm use\`.`,
      );

    if (run("gh", ["auth", "status"]).status !== 0)
      fail(
        "GitHub CLI nie jest zalogowany. Uruchom `gh auth login` i spróbuj ponownie.",
      );

    const repoInfo = must("`gh repo view`", "gh", [
      "repo",
      "view",
      "--json",
      "isTemplate,name,nameWithOwner",
    ]);
    const repo = JSON.parse(repoInfo.stdout);
    if (repo.isTemplate)
      fail(
        `${repo.nameWithOwner} to repozytorium-szablon. Szablon nigdy nie dostaje sekretów wdrożeniowych.\n` +
          "Utwórz własne repozytorium przez „Use this template” na GitHubie, sklonuj je i uruchom komendę tam.",
      );
    if (!SAFE_NAME.test(repo.name))
      fail(`Nazwa repozytorium „${repo.name}” zawiera niedozwolone znaki.`);

    const convexLogin = run(process.execPath, [CONVEX_BIN, "login", "status"]);
    if (convexLogin.status !== 0)
      fail(
        "Convex: brak logowania. Uruchom `npx convex login` i spróbuj ponownie.",
      );

    const deployYml = deps.readFile(join(".github", "workflows", "deploy.yml"));
    if (deployYml === null) fail("Brak .github/workflows/deploy.yml.");
    const vercelVersion = pinnedVercel(/** @type {string} */ (deployYml));
    const vercel = (/** @type {string[]} */ args) =>
      run("npx", [`vercel@${vercelVersion}`, ...args]);
    if (vercel(["whoami"]).status !== 0)
      fail(
        "Vercel: brak logowania. Uruchom `npx vercel@" +
          vercelVersion +
          " login` i spróbuj ponownie.",
      );

    const existing = new Set(
      JSON.parse(
        must("`gh secret list`", "gh", [
          "secret",
          "list",
          "--env",
          ENVIRONMENT,
          "--json",
          "name",
        ]).stdout || "[]",
      ).map((/** @type {{ name: string }} */ s) => s.name),
    );
    const missing = SECRETS.filter((name) => !existing.has(name));

    log(`Repozytorium: ${repo.nameWithOwner}`);
    log(
      missing.length === 0
        ? "Wszystkie sekrety środowiska production już istnieją."
        : `Brakujące sekrety: ${missing.join(", ")}.`,
    );

    if (!dryRun && !options.yes && missing.length > 0) {
      const ok = await deps.confirm(
        `Skonfigurować ${missing.length} sekret(y) w środowisku ${ENVIRONMENT}?`,
      );
      if (!ok) {
        log("Przerwano, nic nie zmieniono.");
        return 1;
      }
    }

    /** @type {Record<string, string>} */
    const values = {};

    if (missing.includes("CONVEX_DEPLOY_KEY")) {
      if (!hasCloudDeployment(deps.readFile(".env.local"))) {
        plan(
          `Convex: tworzę projekt „${repo.name}” (npx convex dev --once --configure new).`,
        );
        if (!dryRun)
          must("Konfiguracja Convex", process.execPath, [
            CONVEX_BIN,
            "dev",
            "--once",
            "--configure",
            "new",
            "--project",
            repo.name,
            "--dev-deployment",
            "cloud",
          ]);
      } else
        log(
          "Convex: .env.local ma już wdrożenie w chmurze, pomijam tworzenie projektu.",
        );
      plan(
        "Convex: tworzę produkcyjny klucz wdrożeniowy (nie jest wypisywany ani zapisywany).",
      );
      if (!dryRun) {
        const key = must("Tworzenie klucza Convex", process.execPath, [
          CONVEX_BIN,
          "deployment",
          "token",
          "create",
          "github-actions",
          "--prod",
        ]).stdout.trim();
        if (!DEPLOY_KEY.test(key)) {
          secretValues.push(key);
          fail(
            "Convex zwrócił klucz w nieoczekiwanym formacie (oczekiwano prod:<nazwa>|<token>).",
          );
        }
        secretValues.push(key);
        values.CONVEX_DEPLOY_KEY = key;
      }
    } else log("Convex: CONVEX_DEPLOY_KEY już ustawiony, pomijam.");

    if (
      missing.includes("VERCEL_ORG_ID") ||
      missing.includes("VERCEL_PROJECT_ID")
    ) {
      const linked = deps.readFile(join(".vercel", "project.json"));
      if (linked === null) {
        plan(
          `Vercel: łączę katalog z projektem „${repo.name}” (vercel link --yes).`,
        );
        if (!dryRun)
          must("Vercel link", "npx", [
            `vercel@${vercelVersion}`,
            "link",
            "--yes",
            "--project",
            repo.name,
          ]);
      } else log("Vercel: .vercel/project.json już istnieje, pomijam link.");
      if (!dryRun) {
        const projectJson = deps.readFile(join(".vercel", "project.json"));
        if (projectJson === null)
          fail("Brak .vercel/project.json po `vercel link`.");
        const { orgId, projectId } = JSON.parse(
          /** @type {string} */ (projectJson),
        );
        if (!orgId || !projectId)
          fail("W .vercel/project.json brakuje orgId lub projectId.");
        values.VERCEL_ORG_ID = orgId;
        values.VERCEL_PROJECT_ID = projectId;
      }
    }

    if (missing.includes("VERCEL_TOKEN")) {
      plan("Vercel: poproszę o token (ukryte pole).");
      if (!dryRun) {
        log(
          "Token Vercel utworzysz na vercel.com → Account Settings → Tokens (scope: Twój zespół, bez wygaśnięcia lub na czas hackathonu).",
        );
        const token = (await deps.readSecret("VERCEL_TOKEN: ")).trim();
        if (!token) fail("Pusty token Vercel.");
        secretValues.push(token);
        values.VERCEL_TOKEN = token;
      }
    }

    const envExists =
      run("gh", [
        "api",
        `repos/${repo.nameWithOwner}/environments/${ENVIRONMENT}`,
      ]).status === 0;
    if (envExists) log(`GitHub: środowisko ${ENVIRONMENT} już istnieje.`);
    else {
      plan(`GitHub: tworzę środowisko ${ENVIRONMENT}.`);
      if (!dryRun)
        must("Tworzenie środowiska", "gh", [
          "api",
          "--method",
          "PUT",
          `repos/${repo.nameWithOwner}/environments/${ENVIRONMENT}`,
        ]);
    }

    for (const name of missing) {
      plan(
        `GitHub: ustawiam sekret ${name} w środowisku ${ENVIRONMENT} (przez stdin).`,
      );
      if (dryRun) continue;
      must(
        `Ustawianie sekretu ${name}`,
        "gh",
        [
          "secret",
          "set",
          name,
          "--env",
          ENVIRONMENT,
          "--repo",
          repo.nameWithOwner,
        ],
        { input: values[name] },
      );
    }

    const rulesetsPath = `repos/${repo.nameWithOwner}/rulesets`;
    const protectCommand = "npm run setup:deploy -- --protect";
    if (options.protect) {
      const listed = JSON.parse(
        must("Lista rulesetów", "gh", ["api", rulesetsPath]).stdout || "[]",
      );
      if (
        listed.some(
          (/** @type {{ name: string }} */ r) => r.name === RULESET_NAME,
        )
      )
        log("GitHub: ruleset dla main już istnieje, pomijam.");
      else {
        plan(
          "GitHub: tworzę ruleset dla main (gate, merge queue, tylko squash, bez force push).",
        );
        if (!dryRun)
          must(
            "Tworzenie rulesetu",
            "gh",
            ["api", "--method", "POST", rulesetsPath, "--input", "-"],
            { input: JSON.stringify(rulesetPayload()) },
          );
      }
    } else
      log(`Ochrona main pominięta. Włączysz ją komendą: ${protectCommand}`);

    log(dryRun ? "\nDry-run: nic nie zmieniono." : "\nGotowe.");
    log(
      "Zmienne backendu ustawisz osobno, np.: npx convex env set AI_PROVIDER mock --prod",
    );
    log(
      "Pierwszy deploy: gh workflow run deploy.yml, podgląd: gh run watch (workflow nie został uruchomiony).",
    );
    return 0;
  } catch (error) {
    if (!(error instanceof SetupError)) throw error;
    log(`Błąd: ${scrub(error.message)}`);
    return 1;
  }
}

/** @returns {Run} */
function systemRun() {
  return (command, args, options) => {
    const result = spawnSync(command, args, {
      encoding: "utf8",
      input: options?.input,
      maxBuffer: 64 * 1024 * 1024,
      // npx is a .cmd shim on Windows; its arguments are fixed, validated strings
      shell: command === "npx" && process.platform === "win32",
      stdio: [
        options?.input === undefined ? "inherit" : "pipe",
        "pipe",
        "pipe",
      ],
    });
    if (result.error)
      return { status: 127, stdout: "", stderr: result.error.message };
    return {
      status: result.status ?? 1,
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? "",
    };
  };
}

/** @param {string} prompt */
function ask(prompt) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) =>
    rl.question(prompt, (answer) => {
      rl.close();
      resolve(answer);
    }),
  );
}

/** Reads a line from the terminal without echoing it. @param {string} prompt */
function readHidden(prompt) {
  return new Promise((resolve, reject) => {
    const { stdin, stdout } = process;
    if (!stdin.isTTY) {
      reject(new Error("Token można wpisać tylko w interaktywnym terminalu."));
      return;
    }
    stdout.write(prompt);
    let buffer = "";
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    const onData = (/** @type {string} */ chunk) => {
      for (const char of chunk) {
        if (char === "\r" || char === "\n" || char === "\u0004") {
          stdin.setRawMode(false);
          stdin.pause();
          stdin.off("data", onData);
          stdout.write("\n");
          resolve(buffer);
          return;
        }
        if (char === "\u0003") {
          stdin.setRawMode(false);
          process.exit(130);
        }
        if (char === "\u007f" || char === "\b") buffer = buffer.slice(0, -1);
        else buffer += char;
      }
    };
    stdin.on("data", onData);
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const code = await runSetup(process.argv.slice(2), {
    run: systemRun(),
    log: (line) => console.log(line),
    confirm: async (q) =>
      /^(y|yes|t|tak)$/i.test((await ask(`${q} [y/N] `)).trim()),
    readSecret: readHidden,
    readFile: (path) => (existsSync(path) ? readFileSync(path, "utf8") : null),
    nodeVersion: process.version,
  });
  process.exit(code);
}

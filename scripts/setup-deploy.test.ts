import { describe, expect, it } from "vitest";
import {
  hasCloudDeployment,
  parseArgs,
  pinnedVercel,
  RULESET_NAME,
  rulesetPayload,
  runSetup,
} from "./setup-deploy.mjs";

type Call = { command: string; args: string[]; input?: string };
type Result = { status: number; stdout: string; stderr: string };

const DEPLOY_KEY = "prod:happy-otter-123|SUPERSECRETKEYVALUE";
const VERCEL_TOKEN = "vercel-token-abc987";
const ok = (stdout = ""): Result => ({ status: 0, stdout, stderr: "" });
const bad = (stderr = ""): Result => ({ status: 1, stdout: "", stderr });

const DEPLOY_YML = "run: npx vercel@65.16.0 pull";
const PROJECT_JSON = JSON.stringify({ orgId: "team_1", projectId: "prj_1" });

interface World {
  isTemplate?: boolean;
  ghLoggedIn?: boolean;
  convexLoggedIn?: boolean;
  vercelLoggedIn?: boolean;
  secrets?: string[];
  envExists?: boolean;
  rulesets?: string[];
  files?: Record<string, string>;
  keyOutput?: string;
  failSecretSet?: boolean;
}

function setup(world: World = {}, argv: string[] = ["--yes"]) {
  const calls: Call[] = [];
  const logs: string[] = [];
  const files: Record<string, string> = {
    [".github/workflows/deploy.yml"]: DEPLOY_YML,
    ...world.files,
  };
  const key = (p: string) => p.replaceAll("\\", "/");

  const run = (
    command: string,
    args: string[],
    options?: { input?: string },
  ) => {
    calls.push({ command, args, input: options?.input });
    const line = args.join(" ");
    if (command === "gh") {
      if (line.startsWith("auth status"))
        return world.ghLoggedIn === false ? bad("not logged in") : ok();
      if (line.startsWith("repo view"))
        return ok(
          JSON.stringify({
            isTemplate: world.isTemplate ?? false,
            name: "my-hack",
            nameWithOwner: "team/my-hack",
          }),
        );
      if (line.startsWith("secret list"))
        return ok(
          JSON.stringify((world.secrets ?? []).map((name) => ({ name }))),
        );
      if (line === "api repos/team/my-hack/environments/production")
        return world.envExists ? ok("{}") : bad("404");
      if (line.includes("--method PUT")) return ok();
      if (line === "api repos/team/my-hack/rulesets")
        return ok(
          JSON.stringify((world.rulesets ?? []).map((name) => ({ name }))),
        );
      if (line.includes("--method POST")) return ok();
      if (line.startsWith("secret set"))
        return world.failSecretSet
          ? bad(`boom while sending ${options?.input}`)
          : ok();
    }
    if (line.includes("login status"))
      return world.convexLoggedIn === false ? bad("no") : ok();
    if (command === "npx" && line.endsWith("whoami"))
      return world.vercelLoggedIn === false ? bad("no") : ok("me");
    if (line.includes("token create"))
      return ok(`${world.keyOutput ?? DEPLOY_KEY}\n`);
    return ok();
  };

  return {
    calls,
    logs,
    files,
    exec: (args = argv) =>
      runSetup(args, {
        run,
        log: (l) => logs.push(l),
        confirm: () => Promise.resolve(true),
        readSecret: () => Promise.resolve(VERCEL_TOKEN),
        readFile: (p) => files[key(p)] ?? null,
        nodeVersion: "v24.22.3",
      }),
    secretSets: () =>
      calls.filter(
        (c) =>
          c.command === "gh" && c.args[0] === "secret" && c.args[1] === "set",
      ),
    mutations: () =>
      calls.filter(
        (c) =>
          (c.command === "gh" &&
            (c.args[0] === "secret"
              ? c.args[1] === "set"
              : c.args.includes("--method"))) ||
          c.args.some((a) => ["link", "create", "dev"].includes(a)),
      ),
  };
}

describe("parseArgs and helpers", () => {
  it("parses flags and rejects unknown ones", () => {
    expect(parseArgs(["--dry-run", "--protect"])).toEqual({
      dryRun: true,
      protect: true,
      yes: false,
    });
    expect(() => parseArgs(["--nope"])).toThrow(/Nieznana opcja/);
  });

  it("reads the pinned vercel version from deploy.yml", () => {
    expect(pinnedVercel(DEPLOY_YML)).toBe("65.16.0");
    expect(() => pinnedVercel("nothing")).toThrow();
  });

  it("detects only cloud deployments in .env.local", () => {
    expect(hasCloudDeployment(null)).toBe(false);
    expect(
      hasCloudDeployment("CONVEX_DEPLOYMENT=dev:cool-fox-1 # team: t"),
    ).toBe(true);
    expect(
      hasCloudDeployment("CONVEX_DEPLOYMENT=anonymous:anonymous-agent"),
    ).toBe(false);
    expect(hasCloudDeployment("CONVEX_DEPLOYMENT=local:local-me")).toBe(false);
    expect(hasCloudDeployment("OTHER=1")).toBe(false);
  });

  it("builds the ruleset from ARCH 10.3", () => {
    const payload = rulesetPayload();
    expect(payload.name).toBe(RULESET_NAME);
    expect(payload.conditions.ref_name.include).toEqual(["refs/heads/main"]);
    const types = payload.rules.map((r) => r.type);
    expect(types).toEqual([
      "deletion",
      "non_fast_forward",
      "pull_request",
      "required_status_checks",
      "merge_queue",
    ]);
    const pr = payload.rules.find((r) => r.type === "pull_request");
    expect(pr?.parameters?.allowed_merge_methods).toEqual(["squash"]);
    const checks = payload.rules.find(
      (r) => r.type === "required_status_checks",
    );
    expect(checks?.parameters?.required_status_checks).toEqual([
      { context: "gate" },
    ]);
  });
});

describe("runSetup", () => {
  it("refuses to run on the template repository and changes nothing", async () => {
    const w = setup({ isTemplate: true }, ["--dry-run"]);
    expect(await w.exec()).toBe(1);
    expect(w.logs.join("\n")).toMatch(/repozytorium-szablon/);
    expect(w.mutations()).toEqual([]);
    expect(w.calls.some((c) => c.args.includes("whoami"))).toBe(false);
  });

  it.each([
    ["gh", { ghLoggedIn: false }, /gh auth login/],
    ["convex", { convexLoggedIn: false }, /npx convex login/],
    ["vercel", { vercelLoggedIn: false }, /vercel@65\.16\.0 login/],
  ])("explains a missing %s login", async (_name, world, message) => {
    const w = setup(world);
    expect(await w.exec()).toBe(1);
    expect(w.logs.join("\n")).toMatch(message);
    expect(w.secretSets()).toEqual([]);
  });

  it("dry-run plans everything and changes nothing", async () => {
    const w = setup({}, ["--dry-run", "--protect"]);
    expect(await w.exec()).toBe(0);
    const out = w.logs.join("\n");
    expect(out).toMatch(/\[dry-run\] Convex: tworzę projekt/);
    expect(out).toMatch(/\[dry-run\] GitHub: ustawiam sekret VERCEL_TOKEN/);
    expect(out).toMatch(/\[dry-run\] GitHub: tworzę ruleset/);
    expect(w.mutations()).toEqual([]);
  });

  it("sets all four secrets through stdin only, never argv or logs", async () => {
    const w = setup({ files: { ".vercel/project.json": PROJECT_JSON } });
    expect(await w.exec()).toBe(0);
    const sets = w.secretSets();
    expect(sets.map((c) => c.args[2]).sort()).toEqual([
      "CONVEX_DEPLOY_KEY",
      "VERCEL_ORG_ID",
      "VERCEL_PROJECT_ID",
      "VERCEL_TOKEN",
    ]);
    const byName = Object.fromEntries(
      sets.map((c): [string, string | undefined] => [c.args[2] ?? "", c.input]),
    );
    expect(byName).toEqual({
      CONVEX_DEPLOY_KEY: DEPLOY_KEY,
      VERCEL_TOKEN,
      VERCEL_ORG_ID: "team_1",
      VERCEL_PROJECT_ID: "prj_1",
    });
    for (const c of sets) expect(c.args).toContain("production");
    const everyArg = w.calls.flatMap((c) => c.args).join("\n");
    expect(everyArg).not.toContain(DEPLOY_KEY);
    expect(everyArg).not.toContain(VERCEL_TOKEN);
    expect(everyArg).not.toContain("--body");
    expect(w.logs.join("\n")).not.toContain("SUPERSECRETKEYVALUE");
    expect(w.logs.join("\n")).not.toContain(VERCEL_TOKEN);
  });

  it("skips Convex creation when .env.local already has a cloud deployment", async () => {
    const w = setup({
      files: {
        ".env.local": "CONVEX_DEPLOYMENT=dev:cool-fox-1",
        ".vercel/project.json": PROJECT_JSON,
      },
    });
    expect(await w.exec()).toBe(0);
    expect(w.calls.some((c) => c.args.includes("--configure"))).toBe(false);
    expect(w.calls.some((c) => c.args.includes("token"))).toBe(true);
  });

  it("skips everything when all secrets and the environment exist", async () => {
    const w = setup({
      secrets: [
        "CONVEX_DEPLOY_KEY",
        "VERCEL_TOKEN",
        "VERCEL_ORG_ID",
        "VERCEL_PROJECT_ID",
      ],
      envExists: true,
    });
    expect(await w.exec()).toBe(0);
    expect(w.secretSets()).toEqual([]);
    expect(w.calls.some((c) => c.args.includes("token"))).toBe(false);
    expect(w.calls.some((c) => c.args.includes("link"))).toBe(false);
    expect(w.logs.join("\n")).toMatch(/już istnieją/);
  });

  it("only sets what is missing", async () => {
    const w = setup({
      secrets: ["CONVEX_DEPLOY_KEY", "VERCEL_ORG_ID", "VERCEL_PROJECT_ID"],
      envExists: true,
    });
    expect(await w.exec()).toBe(0);
    expect(w.secretSets().map((c) => c.args[2])).toEqual(["VERCEL_TOKEN"]);
  });

  it("creates the ruleset with --protect, as JSON on stdin", async () => {
    const w = setup({ files: { ".vercel/project.json": PROJECT_JSON } }, [
      "--yes",
      "--protect",
    ]);
    expect(await w.exec()).toBe(0);
    const post = w.calls.find((c) => c.args.includes("POST"));
    expect(post?.args).toContain("repos/team/my-hack/rulesets");
    expect(JSON.parse(post?.input ?? "{}")).toEqual(rulesetPayload());
  });

  it("skips the ruleset when it already exists, and only prints the command without --protect", async () => {
    const existing = setup(
      {
        rulesets: [RULESET_NAME],
        files: { ".vercel/project.json": PROJECT_JSON },
      },
      ["--yes", "--protect"],
    );
    await existing.exec();
    expect(existing.calls.some((c) => c.args.includes("POST"))).toBe(false);

    const plain = setup({ files: { ".vercel/project.json": PROJECT_JSON } });
    await plain.exec();
    expect(plain.calls.some((c) => c.args.includes("POST"))).toBe(false);
    expect(plain.logs.join("\n")).toMatch(/setup:deploy -- --protect/);
  });

  it("scrubs secrets from errors", async () => {
    const w = setup({
      files: { ".vercel/project.json": PROJECT_JSON },
      failSecretSet: true,
    });
    expect(await w.exec()).toBe(1);
    const out = w.logs.join("\n");
    expect(out).toMatch(/Błąd:/);
    expect(out).toContain("***");
    expect(out).not.toContain("SUPERSECRETKEYVALUE");
  });

  it("rejects a deploy key that is not a production key, without echoing it", async () => {
    const w = setup({ keyOutput: "dev:some-dev|DEVSECRETVALUE" });
    expect(await w.exec()).toBe(1);
    expect(w.logs.join("\n")).toMatch(/nieoczekiwanym formacie/);
    expect(w.logs.join("\n")).not.toContain("DEVSECRETVALUE");
    expect(w.secretSets()).toEqual([]);
  });
});

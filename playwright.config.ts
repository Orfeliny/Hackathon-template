import { existsSync, readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { defineConfig, devices } from "@playwright/test";

if (process.env.VITE_CONVEX_URL) {
  throw new Error(
    "VITE_CONVEX_URL is set in your shell; shell variables beat .env.e2e and would run the smoke test in online mode. Unset it and retry.",
  );
}

// Parsed instead of loadEnvFile so .env.local's VITE_CONVEX_URL never reaches process.env.
const localEnv = existsSync(".env.local")
  ? parseEnv(readFileSync(".env.local", "utf8"))
  : {};
const port = Number(process.env.PREVIEW_PORT ?? localEnv.PREVIEW_PORT ?? 4173);
const isCI = Boolean(process.env.CI);

export default defineConfig({
  testDir: "e2e",
  forbidOnly: isCI,
  retries: isCI ? 1 : 0,
  reporter: [
    ["list"],
    ["json", { outputFile: "reports/playwright.json" }],
    ...(isCI ? [] : ([["html", { open: "never" }]] as const)),
  ],
  use: { baseURL: `http://localhost:${port}`, trace: "on-first-retry" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `npx vite build --mode e2e --outDir dist-e2e && npx vite preview --mode e2e --outDir dist-e2e --port ${port} --strictPort`,
    url: `http://localhost:${port}`,
    reuseExistingServer: !isCI,
    timeout: 120_000,
  },
});

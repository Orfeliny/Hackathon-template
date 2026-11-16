import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { resolvePorts } from "./scripts/lib/lane-env.mjs";

// Ports come from the worktree's .env.local (written by `npm run lane:new`); shell variables win.
const { port, previewPort } = resolvePorts(process.cwd());

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { port, strictPort: true },
  preview: { port: previewPort, strictPort: true },
});

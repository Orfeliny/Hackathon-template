import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// Ports come from the worktree's env files (written by `npm run lane:new`); shell variables win.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), ["PORT", "PREVIEW_PORT"]);
  return {
    plugins: [react(), tailwindcss()],
    server: { port: Number(env.PORT ?? 5173), strictPort: true },
    preview: { port: Number(env.PREVIEW_PORT ?? 4173), strictPort: true },
  };
});

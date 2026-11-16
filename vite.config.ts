import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { port: Number(process.env.PORT ?? 5173), strictPort: true },
  preview: { port: Number(process.env.PREVIEW_PORT ?? 4173), strictPort: true },
});

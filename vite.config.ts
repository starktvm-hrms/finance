import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

// VITE_BASE_PATH lets you host the app under a sub-path of your website, e.g. /finance/
export default defineConfig(({ mode }) => ({
  plugins: [react()],
  // `npm run dev` with VITE_API_URL=/api talks to a local server/api.py
  server: { proxy: { "/api": { target: "http://127.0.0.1:8791", rewrite: (p) => p.replace(/^\/api/, "") } } },
  base: loadEnv(mode, ".", "").VITE_BASE_PATH || "/",
}));

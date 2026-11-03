import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

// VITE_BASE_PATH lets you host the app under a sub-path of your website, e.g. /finance/
export default defineConfig(({ mode }) => ({
  plugins: [react()],
  base: loadEnv(mode, ".", "").VITE_BASE_PATH || "/",
}));

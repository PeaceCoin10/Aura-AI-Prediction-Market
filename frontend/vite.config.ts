import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // Reuse the workspace SDK in place; never copy it (single source of truth)
      "@sdk": resolve(__dirname, "../sdk/CentralPredictionSDK.ts"),
    },
  },
  server: {
    port: 5173,
    host: "0.0.0.0",
    // The SDK lives in the parent directory, so it must be allowed
    fs: { allow: [resolve(__dirname), resolve(__dirname, "..")] },
  },
  build: { outDir: "dist", sourcemap: false, target: "es2020" },
});

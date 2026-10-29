import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // 前端直接复用工作区里的 SDK，不复制一份（单一事实来源）
      "@sdk": resolve(__dirname, "../sdk/CentralPredictionSDK.ts"),
    },
  },
  server: {
    port: 5173,
    host: "0.0.0.0",
    // SDK 在项目父目录，需要放行
    fs: { allow: [resolve(__dirname), resolve(__dirname, "..")] },
  },
  build: { outDir: "dist", sourcemap: false, target: "es2020" },
});

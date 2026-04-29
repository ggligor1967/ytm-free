import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

/// <reference types="vitest/config" />

// https://vitejs.dev/config/
export default defineConfig(async () => ({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: [],
  },

  // Vite options tailored for Tauri development
  clearScreen: false,
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
}));

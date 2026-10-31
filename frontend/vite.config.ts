import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

const host = process.env.HOST || "localhost";

export default defineConfig({
  plugins: [react()],
  server: {
    host,
    port: 5173,
    strictPort: true,
  },
  preview: {
    host,
    port: 5173,
    strictPort: true,
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
    clearMocks: true,
  },
});

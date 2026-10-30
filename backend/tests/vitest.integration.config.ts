import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["**/*.integration.test.ts"],
    fileParallelism: false,
    maxWorkers: 1,
    testTimeout: 120_000,
    hookTimeout: 120_000,
    retry: 0,
  },
});

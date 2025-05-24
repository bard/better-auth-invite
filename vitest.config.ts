/// <reference types="vitest" />
import { defineConfig, configDefaults } from "vitest/config";

export default defineConfig({
  test: {
    testTimeout: 10000,
    coverage: {
      exclude: [
        ...(configDefaults.coverage.exclude ?? []),
        "src/**/*.test.fixtures.ts",
      ],
    },
  },
});

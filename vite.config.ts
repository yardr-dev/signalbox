import { defineConfig } from "vitest/config";

export default defineConfig({
  // Relative, so dist/ works from any path of a static server.
  base: "./",
  test: {
    // The sim is deterministic; loaded runs fail on time, not assertions.
    testTimeout: 30000,
    hookTimeout: 60000,
  },
});

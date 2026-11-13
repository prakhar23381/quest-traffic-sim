import { defineConfig } from "vitest/config";

// Several validation tests simulate 1-2 hours of traffic; allow them time.
export default defineConfig({ test: { testTimeout: 120_000 } });

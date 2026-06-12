import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    tsconfigPaths: true
  },
  test: {
    environment: "node",
    exclude: [...configDefaults.exclude, "TutorLite/**"],
    coverage: {
      reporter: ["text", "json-summary"]
    }
  }
});

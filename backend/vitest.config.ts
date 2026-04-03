import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "bun:test": "vitest",
    },
  },
  test: {
    environment: "node",
    env: {
      GOOGLE_CLIENT_ID: "test-google-client-id",
      GOOGLE_CLIENT_SECRET: "test-google-client-secret",
      OPENAI_API_KEY: "test-openai-api-key",
      RESEND_API_KEY: "test-resend-api-key",
      JWT_SECRET: "test-jwt-secret",
      APP_BASE_URL: "https://test.hearthstone.app",
    },
  },
});

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    timeout: 60000, // 60 seconds for e2e tests
  },
});

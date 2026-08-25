import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    // Config validation deliberately fail-fasts at import time, so tests need
    // a token-shaped value. Nothing here ever reaches Telegram.
    // Pre-setting these stops dotenv from pulling the developer's real .env in,
    // so a test never depends on whether a key happens to be configured - and
    // never makes a live API call or a network request.
    env: {
      TELEGRAM_BOT_TOKEN: '000000:test-token-not-used-by-any-test',
      OWNER_CHAT_ID: '1',
      GEMINI_API_KEY: '',
      LOG_LEVEL: 'error',
      DB_PATH: ':memory:',
      // Blank so tests see every registered source regardless of which boards
      // the developer's .env happens to have switched on. Without this, a
      // machine running SOURCES=yad2,madlan makes the registry tests fail for
      // a configuration reason that has nothing to do with the code.
      SOURCES: '',
      // Same reason: once the developer has logged in and set
      // FACEBOOK_ENABLED=1, the "off by default" test would fail for a
      // configuration reason. Tests that need it on set it themselves.
      FACEBOOK_ENABLED: '0',
    },
  },
});

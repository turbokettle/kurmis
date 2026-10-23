import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // Each test file runs in a process of its own. In worker threads a change to
    // process.env.HOME does not reach os.homedir(), so tests would write the real home folder;
    // test/setup.ts refuses to run there.
    pool: 'forks',
    // Many tests start Node stand-ins for claude, reg.exe and taskkill. On Windows each
    // start takes far longer, and with every file running at once a test that runs in 2 s alone
    // passed the default 5 s.
    testTimeout: process.platform === 'win32' ? 20_000 : 5_000,
    setupFiles: ['test/setup.ts']
  }
})

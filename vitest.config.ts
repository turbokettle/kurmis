import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // Each test file runs in a process of its own. In worker threads a change to
    // process.env.HOME does not reach os.homedir(), so tests would write the real home folder;
    // test/setup.ts refuses to run there.
    pool: 'forks',
    setupFiles: ['test/setup.ts']
  }
})

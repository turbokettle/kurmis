// A child process for the lock test: adds `count` logins with the ids `<prefix>n<i>` to config.json, one
// `changeConfig` each, starting at the time given in milliseconds since epoch so that every child
// starts at once. The test bundles this file with esbuild, since Node 22 cannot run `.ts`.
import { addLogin, changeConfig } from '../../src/data/config.ts'
import { toLoginId } from '../../src/data/login-id.ts'

const [prefix = 'w', countText = '1', startText = '0'] = process.argv.slice(2)
const wait = Number(startText) - Date.now()
if (wait > 0) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, wait)
for (let i = 0; i < Number(countText); i++) {
  changeConfig((config) => addLogin(config, { id: toLoginId(`${prefix}n${String(i)}`), provider: 'claude' }))
}

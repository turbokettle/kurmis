// Logins with fixed made-up ids for tests, so a test can name the machine's own logins without
// reading them back from a config with random ids.
import {
  addLogin,
  CONFIG_VERSION,
  DEFAULT_PORT,
  newLoginSettings,
  saveConfig,
  updateLogin,
  type KurmisConfig,
  type LoginSettings,
  type LoginSettingsPatch
} from '../src/data/config.ts'
import type { LoginId, LoginProvider, LoginRef } from '../src/data/login-id.ts'

/** The id of the machine's own Claude login in a test config. */
export const OWN_CLAUDE = 'ownclaude1' as LoginId

/** The id of the machine's own Codex login in a test config. */
export const OWN_CODEX = 'owncodex01' as LoginId

/** The machine's own Claude login as a `LoginRef`. */
export const OWN_CLAUDE_REF: LoginRef = { id: OWN_CLAUDE, provider: 'claude', machineOwn: true }

/** The machine's own Codex login as a `LoginRef`. */
export const OWN_CODEX_REF: LoginRef = { id: OWN_CODEX, provider: 'codex', machineOwn: true }

/** An extra Claude login with this id, as a `LoginRef`. */
export function claudeRef(id: string): LoginRef {
  return { id: id as LoginId, provider: 'claude', machineOwn: false }
}

/** An extra Codex login with this id, as a `LoginRef`. */
export function codexRef(id: string): LoginRef {
  return { id: id as LoginId, provider: 'codex', machineOwn: false }
}

/** An extra login for `testConfig`: its id and provider, and settings to change. */
export interface ExtraLogin extends LoginSettingsPatch {
  id: string
  provider: LoginProvider
}

export interface TestConfigOptions {
  /** The extra logins, in order. */
  extras?: readonly ExtraLogin[]
  /** Settings of the machine's own Claude login. */
  ownClaude?: LoginSettingsPatch
  /** Settings of the machine's own Codex login. */
  ownCodex?: LoginSettingsPatch
  port?: number
}

/** A config with the machine's own logins at `OWN_CLAUDE` and `OWN_CODEX`, and the given extras. */
export function testConfig(options: TestConfigOptions = {}): KurmisConfig {
  let config: KurmisConfig = {
    version: CONFIG_VERSION,
    port: options.port ?? DEFAULT_PORT,
    logins: [newLoginSettings(OWN_CLAUDE_REF), newLoginSettings(OWN_CODEX_REF)]
  }
  if (options.ownClaude !== undefined) config = updateLogin(config, OWN_CLAUDE, options.ownClaude)
  if (options.ownCodex !== undefined) config = updateLogin(config, OWN_CODEX, options.ownCodex)
  for (const { id, provider, ...patch } of options.extras ?? []) config = addLogin(config, { id: id as LoginId, provider }, patch)
  return config
}

/** Writes `testConfig(options)` to `config.json` in `KURMIS_HOME` and returns it. */
export function writeTestConfig(options: TestConfigOptions = {}): KurmisConfig {
  const config = testConfig(options)
  saveConfig(config)
  return config
}

/** One login of a config by id; throws when it is not there. */
export function loginOf(config: KurmisConfig, id: string): LoginSettings {
  const login = config.logins.find((candidate) => candidate.id === id)
  if (login === undefined) throw new Error(`no login ${id} in the test config`)
  return login
}

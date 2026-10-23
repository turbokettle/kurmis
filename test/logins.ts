// Logins with fixed made-up ids for tests, so a test can name the login of plain claude without
// reading it back from a config with random ids.
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
import type { LoginId, LoginRef } from '../src/data/login-id.ts'

/** The id of the login plain claude uses in a test config. */
export const OWN_CLAUDE = 'ownclaude1' as LoginId

/** The login plain claude uses as a `LoginRef`. */
export const OWN_CLAUDE_REF: LoginRef = { id: OWN_CLAUDE, usedByPlainClaude: true }

/** An extra login with this id, as a `LoginRef`. */
export function claudeRef(id: string): LoginRef {
  return { id: id as LoginId, usedByPlainClaude: false }
}

/** An extra login for `testConfig`: its id, and settings to change. */
export interface ExtraLogin extends LoginSettingsPatch {
  id: string
}

export interface TestConfigOptions {
  /** The extra logins, in order. */
  extras?: readonly ExtraLogin[]
  /** Settings of the login plain claude uses. */
  ownClaude?: LoginSettingsPatch
  port?: number
}

/** A config with the login of plain claude at `OWN_CLAUDE`, and the given extras. */
export function testConfig(options: TestConfigOptions = {}): KurmisConfig {
  let config: KurmisConfig = {
    version: CONFIG_VERSION,
    port: options.port ?? DEFAULT_PORT,
    logins: [newLoginSettings(OWN_CLAUDE_REF)]
  }
  if (options.ownClaude !== undefined) config = updateLogin(config, OWN_CLAUDE, options.ownClaude)
  for (const { id, ...patch } of options.extras ?? []) config = addLogin(config, id, patch)
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

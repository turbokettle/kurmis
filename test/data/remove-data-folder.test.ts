import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { isKurmisEntry, removeDataFolder } from '../../src/data/remove-data-folder.ts'
import { linkFolder } from '../host.ts'

const home = process.env.HOME!
const dataFolder = process.env.KURMIS_HOME!

/** Fills a folder with what kurmis writes, and a login folder with a link to `~/shared/skills` in it. */
function fill(folder: string): void {
  mkdirSync(join(folder, 'claude', 'work'), { recursive: true })
  mkdirSync(join(folder, 'probe', 'claude-default'), { recursive: true })
  for (const name of ['config.json', 'key', 'state.json', 'daemon.log', 'daemon.log.1', 'paused.json', 'config.json.4242.0a1b2c3d.tmp', '.key-4242-0a1b2c3d']) {
    writeFileSync(join(folder, name), '{}')
  }
  linkFolder(join(home, 'shared', 'skills'), join(folder, 'claude', 'work', 'skills'))
}

beforeEach(() => {
  rmSync(dataFolder, { recursive: true, force: true, maxRetries: 10 })
  mkdirSync(join(home, 'shared', 'skills'), { recursive: true })
  writeFileSync(join(home, 'shared', 'skills', 'one.md'), 'kept')
})

afterEach(() => {
  rmSync(join(home, 'shared'), { recursive: true, force: true, maxRetries: 10 })
})

describe('isKurmisEntry', () => {
  it('knows the names kurmis writes and their temporary and rotated forms', () => {
    for (const name of ['config.json', 'config.json.lock', 'config.json.lock.break', 'daemon.json.removing', 'daemon.log.1', 'key',
      '.key-1-ab', 'autostart.js', 'claude', 'locks', 'probe', 'settings', 'paused.json',
      'settings-files.json', 'settings-files.json.lock']) {
      expect(isKurmisEntry(name)).toBe(true)
    }
    for (const name of ['notes.txt', 'keys', 'Documents', '.git', 'configjson']) expect(isKurmisEntry(name)).toBe(false)
  })
})

describe('removeDataFolder', () => {
  it('deletes the folder without following a link out of it', () => {
    fill(dataFolder)
    expect(removeDataFolder()).toEqual({ path: dataFolder, removed: true, left: [] })
    expect(existsSync(dataFolder)).toBe(false)
    expect(readFileSync(join(home, 'shared', 'skills', 'one.md'), 'utf8')).toBe('kept')
  })

  it('leaves the folder and the files kurmis did not write', () => {
    fill(dataFolder)
    writeFileSync(join(dataFolder, 'notes.txt'), 'mine')
    expect(removeDataFolder()).toEqual({ path: dataFolder, removed: false, left: ['notes.txt'] })
    expect(readdirSync(dataFolder)).toEqual(['notes.txt'])
  })

  it('deletes the files Finder and Explorer leave when nothing else is left, and never names them', () => {
    fill(dataFolder)
    for (const name of ['.DS_Store', 'Thumbs.db', 'desktop.ini']) writeFileSync(join(dataFolder, name), '')
    expect(removeDataFolder()).toEqual({ path: dataFolder, removed: true, left: [] })
    expect(existsSync(dataFolder)).toBe(false)

    fill(dataFolder)
    writeFileSync(join(dataFolder, '.DS_Store'), '')
    writeFileSync(join(dataFolder, 'notes.txt'), 'mine')
    expect(removeDataFolder()).toEqual({ path: dataFolder, removed: false, left: ['notes.txt'] })
    expect(readdirSync(dataFolder).sort()).toEqual(['.DS_Store', 'notes.txt'])
  })

  it('answers removed for a folder that is not there', () => {
    expect(removeDataFolder()).toEqual({ path: dataFolder, removed: true, left: [] })
  })

  it('empties and removes the folder a linked data folder points to, then the link', () => {
    const target = join(home, 'elsewhere', 'kurmis-data')
    mkdirSync(target, { recursive: true })
    fill(target)
    linkFolder(target, dataFolder)
    try {
      expect(lstatSync(dataFolder).isSymbolicLink()).toBe(true)
      expect(removeDataFolder().removed).toBe(true)
      expect(existsSync(target)).toBe(false)
      expect(existsSync(dataFolder)).toBe(false)
      expect(existsSync(join(home, 'elsewhere'))).toBe(true)
      expect(readFileSync(join(home, 'shared', 'skills', 'one.md'), 'utf8')).toBe('kept')
    } finally {
      rmSync(join(home, 'elsewhere'), { recursive: true, force: true, maxRetries: 10 })
    }
  })
})

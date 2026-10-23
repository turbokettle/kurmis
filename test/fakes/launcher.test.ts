import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { installLauncher } from './launcher.ts'

let bin: string

beforeEach(() => {
  bin = mkdtempSync(join(tmpdir(), 'kurmis-launcher-'))
})

afterEach(() => {
  rmSync(bin, { recursive: true, force: true, maxRetries: 10 })
})

it('writes an executable shell script that runs the fake with this Node on POSIX', () => {
  const installed = installLauncher(bin, 'claude', "/scripts/it's here.js", 'darwin')
  expect(installed.path).toBe(join(bin, 'claude'))
  expect(installed.command).toEqual([process.execPath, "/scripts/it's here.js"])
  const text = readFileSync(installed.path, 'utf8')
  expect(text).toMatch(/^#!\/bin\/sh\nexec '/)
  expect(text).toContain("'/scripts/it'\\''s here.js' \"$@\"")
  // Windows has no execute bits; Node reports none.
  if (process.platform !== 'win32') expect(statSync(installed.path).mode & 0o111).not.toBe(0)
})

it('writes a .cmd file on Windows', () => {
  const installed = installLauncher(bin, 'claude', 'C:\\fakes\\fake-claude.js', 'win32')
  expect(installed.path).toBe(join(bin, 'claude.cmd'))
  expect(readFileSync(installed.path, 'utf8')).toBe(`@echo off\r\n"${process.execPath}" "C:\\fakes\\fake-claude.js" %*\r\n`)
})

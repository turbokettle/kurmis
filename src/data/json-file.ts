// Reading and writing kurmis' JSON files so that a reader never sees half a file.
//
// A write goes to a new temp file in the same folder, is flushed to the disk, and is then
// renamed over the destination. A crash leaves the old file or the new one, never a mix. The
// temp file is created with O_EXCL, so a write only ever removes a temp file it made itself.
import { randomBytes } from 'node:crypto'
import { closeSync, constants, fsyncSync, openSync, readFileSync, rmSync, writeSync } from 'node:fs'
import { open, rm } from 'node:fs/promises'
import { dirname } from 'node:path'
import {
  makePrivateDirSync,
  replaceFile,
  replaceFileSync,
  syncDirectory,
  syncDirectorySync
} from '../platform/files.ts'

export interface WriteOptions {
  /** The file's mode, e.g. `PRIVATE_FILE_MODE` for a file holding a secret. Default 0o644. */
  mode?: number
}

const TEMP_FLAGS = constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL

function tempPathFor(path: string): string {
  return `${path}.${String(process.pid)}.${randomBytes(4).toString('hex')}.tmp`
}

/** Replaces `path` with `contents`. Creates the folder (private on POSIX) when it is missing. */
export function writeFileAtomicSync(path: string, contents: string, options: WriteOptions = {}): void {
  const dir = dirname(path)
  makePrivateDirSync(dir)
  const temp = tempPathFor(path)
  const fd = openSync(temp, TEMP_FLAGS, options.mode ?? 0o644)
  try {
    try {
      writeSync(fd, contents)
      fsyncSync(fd)
    } finally {
      closeSync(fd)
    }
    replaceFileSync(temp, path)
  } catch (error) {
    rmSync(temp, { force: true })
    throw error
  }
  syncDirectorySync(dir)
}

/** The same as `writeFileAtomicSync`, without blocking the event loop on the disk. */
export async function writeFileAtomic(path: string, contents: string, options: WriteOptions = {}): Promise<void> {
  const dir = dirname(path)
  makePrivateDirSync(dir)
  const temp = tempPathFor(path)
  const handle = await open(temp, TEMP_FLAGS, options.mode ?? 0o644)
  try {
    try {
      await handle.writeFile(contents)
      await handle.sync()
    } finally {
      await handle.close()
    }
    await replaceFile(temp, path)
  } catch (error) {
    await rm(temp, { force: true })
    throw error
  }
  await syncDirectory(dir)
}

/** Two-space indented JSON with a final newline, so the files are readable and diff well. */
export function formatJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`
}

export function writeJsonFileSync(path: string, value: unknown, options?: WriteOptions): void {
  writeFileAtomicSync(path, formatJson(value), options)
}

export async function writeJsonFile(path: string, value: unknown, options?: WriteOptions): Promise<void> {
  await writeFileAtomic(path, formatJson(value), options)
}

/**
 * What reading a JSON file found. `missing` is a file that does not exist, which callers
 * usually treat as empty. `corrupt` is a file that exists but is not JSON. Any other read
 * error (no permission, a folder in its place) is thrown.
 */
export type JsonReadResult =
  | { status: 'missing' }
  | { status: 'ok'; value: unknown }
  | { status: 'corrupt'; reason: string }

function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | null)?.code === 'ENOENT'
}

export function readJsonFileSync(path: string): JsonReadResult {
  let text: string
  try {
    text = readFileSync(path, 'utf8')
  } catch (error) {
    if (isMissing(error)) return { status: 'missing' }
    throw error
  }
  try {
    return { status: 'ok', value: JSON.parse(text) as unknown }
  } catch (error) {
    return { status: 'corrupt', reason: error instanceof Error ? error.message : String(error) }
  }
}

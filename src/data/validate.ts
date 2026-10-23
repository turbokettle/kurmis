// Small checks for the values read from kurmis' JSON files. Each check names the file and the
// field it was looking at, so an error reads like
// `/path/config.json: logins[1].weeklyLimit must be a whole number from 1 to 100, not 150`.

export class DataFileError extends Error {
  constructor(
    readonly file: string,
    readonly field: string | null,
    problem: string
  ) {
    super(field === null ? `${file}: ${problem}` : `${file}: ${field} ${problem}`)
    this.name = 'DataFileError'
  }
}

/** Where a value was found: the file, and the field path inside it (empty for the top level). */
export interface Where {
  file: string
  field: string
}

export function topOf(file: string): Where {
  return { file, field: '' }
}

/** The location of a key of an object (`logins[1].alias`) or an index of an array. */
export function child(where: Where, key: string | number): Where {
  if (typeof key === 'number') return { file: where.file, field: `${where.field}[${String(key)}]` }
  return { file: where.file, field: where.field === '' ? key : `${where.field}.${key}` }
}

export function fail(where: Where, problem: string): never {
  throw new DataFileError(where.file, where.field === '' ? null : where.field, problem)
}

/** A short, safe description of a value for an error message. Strings are not repeated. */
export function describe(value: unknown): string {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'a list'
  if (typeof value === 'string') return 'a string'
  if (typeof value === 'object') return 'an object'
  return String(value)
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function expectObject(value: unknown, where: Where): Record<string, unknown> {
  if (!isPlainObject(value)) fail(where, `must be an object, not ${describe(value)}`)
  return value
}

export function expectArray(value: unknown, where: Where): unknown[] {
  if (!Array.isArray(value)) fail(where, `must be a list, not ${describe(value)}`)
  return value
}

export function expectString(value: unknown, where: Where): string {
  if (typeof value !== 'string') fail(where, `must be a string, not ${describe(value)}`)
  return value
}

export function expectBoolean(value: unknown, where: Where): boolean {
  if (typeof value !== 'boolean') fail(where, `must be true or false, not ${describe(value)}`)
  return value
}

export function expectInteger(value: unknown, where: Where, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    fail(where, `must be a whole number from ${String(min)} to ${String(max)}, not ${describe(value)}`)
  }
  return value
}

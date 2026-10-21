import { describe, expect, it } from 'vitest'
import { CONTROL_PATHS } from '../../src/core/control-api.ts'
import { requestKind } from '../../src/core/proxy-rules.ts'

describe('control paths', () => {
  it('are all read as control requests, never routed upstream', () => {
    for (const path of Object.values(CONTROL_PATHS)) {
      expect(requestKind('POST', path)).toEqual({ kind: 'control', path })
      expect(requestKind('GET', `${path}?x=1`)).toEqual({ kind: 'control', path })
    }
  })
})

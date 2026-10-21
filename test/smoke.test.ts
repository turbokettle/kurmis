import { expect, it } from 'vitest'

it('runs with a temporary home', () => {
  expect(process.env.KURMIS_HOME).toContain('kurmis-test-home-')
})

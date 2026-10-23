// What KURMIS_CLAUDE_BIN names in every test that does not name a fake itself (test/setup.ts).
// Without it, kurmis code that a test runs, such as the daemon's usage probe, would search PATH
// and could start the real claude against the real credentials. It does nothing and fails, so
// such a test fails loudly instead.
import process from 'node:process'

process.stderr.write('no-real-program: this test did not name a fake claude (KURMIS_CLAUDE_BIN)\n')
process.exitCode = 97

// What KURMIS_CLAUDE_BIN and KURMIS_CODEX_BIN name in every test that does not name a fake
// itself (test/setup.ts). Without it, kurmis code that a test runs, such as the daemon's usage
// probes, would search PATH and could start the real claude or codex against the real
// credentials. It does nothing and fails, so such a test fails loudly instead.
import process from 'node:process'

process.stderr.write('no-real-program: this test did not name a fake claude or codex (KURMIS_CLAUDE_BIN / KURMIS_CODEX_BIN)\n')
process.exitCode = 97

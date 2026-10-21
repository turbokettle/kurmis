// What `KURMIS_WSCRIPT_PROGRAM` names in every test (test/setup.ts). Kurmis never runs
// `wscript.exe` itself: it writes its path into the Windows logon entry and checks that the file
// exists. So this stand-in only has to exist; when something runs it anyway, it fails.
import process from 'node:process'

process.stderr.write('fake wscript: kurmis does not run wscript itself; this stand-in only has to exist\n')
process.exit(97)

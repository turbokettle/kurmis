// The kurmis version. `scripts/build.mjs` replaces `KURMIS_VERSION` with the version in
// package.json; code run from source (the tests) sees `dev`.
declare const KURMIS_VERSION: string

export const kurmisVersion: string = typeof KURMIS_VERSION === 'string' ? KURMIS_VERSION : 'dev'

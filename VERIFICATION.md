# Verification

Run `npm ci`, `npm run typecheck`, `npm run build` and `npm test` from a clean source copy. Installation prepares the actual stdio MCP adapter. The first-use path in README uses real local MCP/API records and requires no model-provider key.

The local suite labels deterministic provider fixtures as offline. They do not establish live model success. Two optional hosted-OAuth test files are explicitly excluded by the local runner. The actual Docker-dependent check requires an explicit opt-in on the approved Linux host and is skipped on the Mac. All ordinary offline receipt/auth/review regression tests remain in the suite.

Builder receipts and the independent fresh-user trial are kept separately from this source package. Do not treat a test result from an earlier source version as a pass for this candidate. The private trial has a separate optional live-model ceiling of12 requests/$0.05, including unknown outcomes; the builder makes no paid calls during installation testing.

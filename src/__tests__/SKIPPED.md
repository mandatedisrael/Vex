# Root-suite skipped-test ledger

The root Vitest suite currently contains no intentional `it.skip` tests.
The previous seven-entry ledger covered tests blocked on the disabled
`SUBAGENT_TOOLS` surface; that subsystem was removed (S1b engine cut), and
the skipped bodies were deleted with it. This is a release-report ledger;
platform-gated and opt-in integration tests are not included because they
are conditional rather than skipped test bodies.

| Test | File | Skip reason |
|---|---|---|
| _none_ | — | — |

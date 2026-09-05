# image-size 2.0.2 parser progress guards

The npm release has no upstream fixed version for
[GHSA-w3rx-r6r6-pgpr](https://github.com/advisories/GHSA-w3rx-r6r6-pgpr)
and [GHSA-5p2g-fcmc-qvqq](https://github.com/advisories/GHSA-5p2g-fcmc-qvqq)
as of 2026-09-05. The pnpm patch rejects ICNS entry lengths smaller than the
header or outside the buffer and refuses ISO boxes smaller than their header.
All distributed CJS/ESM bundles are patched so every parser loop advances.

Only these two advisories are excluded from the version-based audit because
the installed code is patched. `tests/unit/image-size-security.test.ts`
executes the three malformed fixtures in timeout-bounded child processes for
both module formats and verifies valid PNG/ICNS input. Docker build and
migration stages both copy the patch before frozen installation. Remove the
patch and advisory exceptions together after upgrading to a fixed release.

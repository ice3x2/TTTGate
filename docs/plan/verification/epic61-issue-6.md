# Issue #6 — Certificate input lifecycle

Status: complete; independently reviewed, integrated, pushed, closed and notified.
Original title: `InputCertFile` 의 `afterUpdate` 가 Svelte 5 에서 무한 갱신 루프를 일으킴.
Assigned agent: `fix_ci14`; branch `fix/epic61-ui-cert`; base `9281bb2`.
Worktree: `C:/Work/git/_Snoworca/TTTGate-epic61-ui`.
Writable paths: `admin/src/layout/InputCertFile.svelte`, dedicated
`admin/test/CertificateFixture.svelte`, `admin/test/certificate.html`,
`test/admin/certificate-lifecycle.test.ts`, and this ledger.
Next action: none for this issue; #7 now assigned separately, #8 remains later.

## Findings and minimum repair

The historical `effect_update_depth_exceeded` mount failure was **not reproduced**
on the currently installed Svelte 5.57.0. It is not claimed as RED evidence.
The same unconditional afterUpdate reset does reproducibly erase a partially
selected private-key file during an unrelated parent redraw and invalid-
certificate alert. This prevents completing the key/certificate pair. A null
parent certificate also fails to clear the existing native file selections.

Remove the afterUpdate reset and its unused lifecycle imports. A prop-only
reactive call compares certificate content with a deep snapshot, using existing
ObjectUtil.equalsDeep and lodash.cloneDeep. Changed parent data resets the native
files; an equivalent replacement object or unrelated component/parent update
preserves unfinished user selection. Null/undefined certificate values use the
same empty shape as initial mounting. The initial onMount reset remains. No new
snapshot framework, timer or subscription was added.

The issue also requests inspection of Gauge and Timer. Real Svelte 5 mounting,
updates through their normal props/exports, and unmounting passed before this
repair, so their source is unchanged. #5's native CSPRNG challenge and hash
compatibility implementation are preserved.

## Checklist and test-first evidence

- [x] Inspect issue, current execution plan, component consumers and reusable browser/certificate helpers.
  Status: complete. Reused the existing browser helper, native File/DataTransfer/FileReader and real 2048-bit certificate generation helper. Fixture uses actual parent prop updates/events and actual component mounting, without browser or component mocks.
- [x] Reproduce draft reset before production changes.
  Status: RED. `node node_modules/jest/bin/jest.js --runInBand --runTestsByPath test/admin/certificate-lifecycle.test.ts` exited 1: one failed/three passed in 15.386 seconds. After selecting `draft-key.pem`, an unrelated redraw and invalid-certificate alert leave the key file undefined. Existing mount/unmount, parent refresh, Gauge and Timer cases passed; no update-depth failure was invented.
- [x] Reproduce nullable parent reset before production changes.
  Status: RED. Same command with `-t 'null parent'` exited 1: the null-prop case failed to clear native file inputs within three seconds (four other cases not selected), 7.901 seconds total. This covers the component's existing declared nullable prop contract.
- [x] Apply scoped lifecycle repair after both RED checks.
  Status: complete. Source changes are confined to InputCertFile's prop initialization/snapshot/reset trigger; certificate validation, RSA proof, challenge generation, API controllers and other components are unchanged.
- [x] Execute focused browser regression and static check.
  Status: GREEN. Full dedicated command passed five tests in 13.802 seconds. It covers initial mount/unmount, retained draft across redraw/error alert/equivalent props, completing a valid key pair and emitting one update, changed/reused-identity parent props, empty/null clearing, and unchanged Gauge/Timer lifecycle paths. `npm --prefix admin run check` exited 0 with zero errors/ten pre-existing accessibility/CSS warnings.
- [x] Run the complete administrator browser suite, including production entrypoint build.
  Status: GREEN. `npm --prefix admin test` exited 0 naturally: five suites/14 tests passed in 43.956 seconds. Existing development/production entrypoints and both browser hash contexts remain green. The entrypoint suite builds the real production administrator bundle.
- [x] Independent review and any corrections.
  Status: PASS by `review_wave0`; five focused browser tests passed, no material findings. Proposed title: `fix: 인증서 입력을 실제 prop 변경에만 동기화`.
- [x] Commit, integration regression, remote verification, closure and Telegram report.
  Status: complete; operational evidence below.

## Evidence limits

The repair removes the problematic unconditional reset, but current evidence
does not demonstrate the historical-version update-depth crash. It demonstrates
the current draft-reset failure and correct prop-driven behavior under real
Chromium/Svelte 5.57.0 on Node v24.16.0. CSRF requests, bootstrap login, API error
handling and later end-to-end requirements remain separately scheduled.

## Operational completion

Integration commit and independently observed pushed remote HEAD: `67d81239936d98b05ffeff0765e9f6c3e6979c64`. GitHub independently confirmed CLOSED at `2026-09-07T17:18:59Z`. Root reports all five focused integration browser tests passed in 16.356 seconds; broader administrator/static checks were recorded above.

Telegram title: TDD Gate 6 `InputCertFile` 의 `afterUpdate` 가 Svelte 5 에서 무한 갱신 루프를 일으킴 (61/14). Successful message `3915` is from the orchestrator's tool receipt, not an independent Telegram fetch. Historical crash reproduction limitations remain unchanged. Do not duplicate the notification.

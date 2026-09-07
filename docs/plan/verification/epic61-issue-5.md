# Issue #5 — Svelte 5 administrator entrypoint

Status: complete; independently reviewed, integrated, pushed, closed and notified.
Original title: 관리자 SPA 가 Svelte 4 클래스 API 를 호출해 부팅되지 않음.
Assigned agent: `fix_ci14`; branch `fix/epic61-ui`; base `b093dce`.
Worktree: `C:/Work/git/_Snoworca/TTTGate-epic61-ui`.
Writable paths: admin package manifest/lock, `admin/src/main.ts`,
`admin/test/server.mjs`, `test/helpers/adminBrowser.ts`,
`test/admin/entrypoint.test.ts`, and this ledger. Root subsequently authorized
only LoginCtrl's hash implementation, InputCertFile's challenge generation,
`admin/src/util/hash.ts`, and dedicated hash fixtures/tests to complete the
original crypto-js removal without introducing a declaration shim.
Next action: none for this issue; #6 starts separately after integration; #8 remains later.

## Scope and reuse

The original user's dirty administrator manifest establishes the intended Svelte
5/Vite 6 upgrade. Its compatible plugin, Svelte-check, tsconfig and tslib ranges
are applied while retaining integrated Node >=24, TypeScript ^5.9.3 and the Jest
test command. The original workspace remains untouched. The old admin lockfile
caused npm ERESOLVE between plugin 2/inspector 1 and plugin 5; regenerated only
this lane's admin lockfile rather than forcing incompatible peer resolution.
The installed environment is Svelte 5.57.0, Vite 6.4.3, TypeScript 5.9.3.

The entrypoint imports Svelte `mount` and replaces the `new App` call.
The approved crypto-js adoption is documented below. No production compatibility mode or Svelte 4 retention is
used. The #50 browser driver is extended to run both Vite development and actual
production-build preview. Its test-only API proxy targets a real loopback
AdminServer and preserves `/api` paths. The production entrypoint/index is loaded,
not the neutral component fixture. Authentication, TLS and login behavior are
not replaced with mocks or changed by this entrypoint fix.

## Checklist and TDD evidence

- [x] Inspect issue, current plan, original upgrade intent and existing browser/backend helpers.
  Status: complete; reused #50 browser process, existing real AdminServer and temporary runtime roots. Node 24 and integrated test policy preserved.
- [x] Require the intended upgraded environment before dependency changes.
  Status: RED. `node node_modules/jest/bin/jest.js --runInBand --runTestsByPath test/admin/entrypoint.test.ts -t 'intended Svelte'` failed because manifest Svelte was ^4.0.5, not ^5.x.
- [x] Reproduce actual source and production entrypoint failures before the final mount implementation.
  Status: RED. After Svelte 5 installation and actual API/preview fixture setup, both entrypoint tests failed. An initial fix was fully removed when detecting that inherited NODE_ENV=test could make the build use development semantics. With explicit development and production environments, the unchanged `new App` entrypoint again failed both tests: development `component_api_invalid_new`, production `effect_orphan`. Exact final RED command: `node node_modules/jest/bin/jest.js --runInBand --runTestsByPath test/admin/entrypoint.test.ts`; two failed/one passed in 11.301 seconds. Production case verifies the served index references `/assets/`; development references `/src/main.ts`.
- [x] Apply minimum Svelte mount change only after the corrected RED.
  Status: complete. The later approved hash implementation/challenge replacement preserves existing login request structure. No certificate lifecycle, bootstrap or CSRF changes were included.
- [x] Run administrator regression, production build and backend build.
  Status: GREEN. `npm --prefix admin test` exited 0: three suites/six tests passed in 24.453 seconds. Each production entrypoint test builds the real admin app with NODE_ENV=production before previewing it. Both real entrypoints render the Sign in heading and password field without browser page errors. Existing AlertLayout interaction and legacy browser/server hash contracts pass. `npm run build` exited 0.
- [x] Verify regenerated lockfile installation and record additional static diagnostics.
  Status: `npm ci --prefix admin --no-audit --no-fund` exited 0 (102 packages before crypto-js removal). Initial `npm --prefix admin run check` exited 1 with two missing crypto-js declaration errors in LoginCtrl.ts/InputCertFile.svelte and ten existing-style accessibility/CSS warnings. Root approved bounded removal/hash adoption after that report; final static check passes with zero errors/ten warnings. No declaration shim or weakened checking was introduced.
- [x] Independent review and any corrections.
  Status: PASS by `review_wave0`; nine browser tests passed and static check found zero errors/ten existing warnings. Proposed title: `fix: Svelte 5 관리자 앱 구동과 해시 호환성 복구`.
- [x] Commit, integration regression, remote verification, issue closure and Telegram report.
  Status: complete; operational evidence below.

## Approved crypto-js removal and explicit HTTP compatibility

The original user's uncommitted `hash.ts` uses native SHA-512 and native random
bytes, and their LoginCtrl/InputCertFile edits replace the two CryptoJS calls.
Those files remained untouched in the original workspace. They were used as a
reference only after new failing regressions were recorded in this lane.

The original helper could not be copied unchanged: `crypto.subtle` is restricted
to secure contexts, whereas `crypto.getRandomValues` remains available on ordinary
HTTP. This compatibility gap was reported to root before implementation; root
explicitly approved existing node-forge SHA-512 when SubtleCrypto is absent. Both
paths hash the identical TextEncoder-produced UTF-8 bytes. Native digest failures
are not caught and silently retried; the capability branch only covers absence.
Authentication/TLS defaults and explicit HTTP deployment policy are unchanged.
Sources: [SubtleCrypto availability](https://developer.mozilla.org/en-US/docs/Web/API/Crypto/subtle),
[native random availability](https://developer.mozilla.org/en-US/docs/Web/API/Crypto/getRandomValues).

- [x] Write native/helper/dependency/browser contracts before adoption.
  Status: RED. `node node_modules/jest/bin/jest.js --runInBand --runTestsByPath test/admin/crypto-replacement.test.ts` failed three tests in 15.335 seconds: crypto-js remained declared and both actual browser origins could not load the missing hash utility. The insecure-origin fixture first demonstrated `isSecureContext=false`, SubtleCrypto absent and native getRandomValues present. Earlier fixture DNS/timeout setup failures were corrected before this functional RED.
- [x] Adopt the bounded original changes with same-algorithm HTTP compatibility.
  Status: implemented after RED. Login normalization/salt and request body are unchanged; SHA-512 implementation moves to the shared helper. Certificate challenge becomes `randomHex(64)`, still 128 lowercase hex characters, using only native getRandomValues. No lifecycle code was edited. `npm uninstall --prefix admin crypto-js --no-audit --no-fund` updated manifest/lock without a new dependency; forge already shipped.
- [x] Verify both real browser capabilities, hashes and challenge format.
  Status: dedicated GREEN three tests passed, 4.074 seconds. Native and forge paths match Node SHA-512 and the real server legacy hash for ASCII, Korean/supplementary Unicode, whitespace normalization and empty strings. Challenges retain their 128-hex format and differ between calls; source contract ensures native getRandomValues and no timestamp/Math.random generator. The test-only `admin.test` hostname resolves inside Chromium to 127.0.0.1, and only the test server allows that hostname; the server remains loopback-bound. No browser API or crypto function is mocked, and no production host/proxy/security setting changes.
- [x] Execute combined administrator/static/backend checks after adoption.
  Status: `npm --prefix admin test` exited 0, four suites/nine tests passed in 17.249 seconds, including actual development and production entrypoints. `npm --prefix admin run check` exited 0 with zero errors and ten unrelated accessibility/CSS warnings. `npm run build` exited 0.

## Limits and following work

This proves anonymous entrypoint rendering in development and production under
Svelte 5. It does not prove logged-in certificate lifecycle (#6), CSRF (#7),
bootstrap/raw-password login (#8), or removal of obsolete empty-key discovery
(#51). The retained legacy-hash test is not a claim that the current login wire
contract is correct; that separately identified mismatch remains #8's scope.
Local execution used Node v24.16.0/Chromium; a hosted workflow run is not claimed.

## Operational completion

Integration commit: `6a3b94c`. Independently observed subsequent remote HEAD: `9281bb23067bf7f34487a079ae98ecbac6d15f4b`. GitHub independently confirmed CLOSED at `2026-09-07T16:58:00Z`. Root reports administrator static check with zero errors/ten existing warnings and 20 integration tests passed.

Telegram title: `TDD Gate 5 관리자 SPA 가 Svelte 4 클래스 API 를 호출해 부팅되지 않음 (61/11)`. Successful message `3911` is from the orchestrator's tool receipt, not an independent Telegram fetch. Do not duplicate the notification.

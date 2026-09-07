# Issue #67 — Trusted development proxy Origin adaptation

Status: complete; independently reviewed, integrated, pushed, closed and notified.
Original title: Vite 개발 프록시의 Origin 불일치로 인증된 설정 변경 요청이 403으로 거부됨.
Assigned agent: `fix_ci14`; branch `fix/epic61-dev-origin`; base `2b0a426`.
Worktree: `C:/Work/git/_Snoworca/TTTGate-epic61-ui`.
Writable paths: `admin/vite.config.ts`, the existing test server/browser helper,
dedicated proxy HTML/build fixtures and `test/admin/dev-proxy-origin.test.ts`,
and this ledger. No backend, login or production controller source changed.
Next action: none for this issue; frontend #8 follows separately.

## Approved boundary and reuse

Vite 6 preview inherits server.proxy, and the existing package exposes preview.
One narrow hook is therefore shared by configureServer/configurePreviewServer.
For /api requests with a present Origin, the hook requires a canonical origin,
actual socket HTTP/HTTPS scheme and local port, matching Host authority, and an
independently trusted socket-local/configured non-wildcard hostname or loopback
alias. Host or X-Forwarded-* fields alone cannot confer trust; allowedHosts:true
is not consulted. Credentials, paths, query, fragments and opaque/null origins
are rejected rather than normalized into a trusted origin.

Only after these checks is Origin rewritten to the actual resolved proxy target's
origin. The existing target path, /api rewrite, changeOrigin, ws and TLS options
remain unchanged. No backend Origin/CSRF policy is disabled. Missing Origin is
forwarded unchanged, as explicitly directed by root, retaining authenticated
CLI POST/DELETE behavior and their backend CSRF requirements.

The test helper's new target override changes only the configured backend target
to an ephemeral port and retains the real proxy's other settings. Preview inherits
that actual server proxy instead of using a reconstructed proxy. A tiny additional
HTML input makes the same real controller fixture available in the production
preview build. Existing browser/auth/runtime helpers are reused; actual AdminServer
cookies establish test auth without changing the still-pending #8 UI login flow.
All acquired API/browser/temp-root resources are covered by nested finally cleanup,
including setup failures.

## Checklist and TDD evidence

- [x] Read #67, actual Vite/preview configuration, backend Origin guard and current plan.
  Status: complete; root and primary reviewer approved the narrow shared hook and explicitly preserved requests without Origin.
- [x] Write real configured-development and preview regressions before source adaptation.
  Status: RED. `node node_modules/jest/bin/jest.js --runInBand --silent --runTestsByPath test/admin/dev-proxy-origin.test.ts` exited 1: both tests failed in 19.426 seconds. Actual browser mutations and legitimate loopback aliases returned 403. Requests spoofing backend Origin/Host port returned 200 despite arriving at the development listener. Direct authenticated backend self-Origin request returned 200, isolating the proxy mismatch. No API/browser method was mocked.
- [x] Add the shared hook after RED without changing upstream security or proxy path semantics.
  Status: implemented only in Vite configuration. Canonical parsing uses Node 24's URL.canParse, and runtime socket metadata anchors scheme/port independently of client headers. Actual configured target is read from resolved development/preview settings, not a hardcoded 9300 port.
- [x] Execute focused real-browser and raw-header boundary checks.
  Status: GREEN. Initial dedicated run passed both tests in 15.737 seconds. Explicit no-Origin DELETE compatibility assertions were then added without source changes; final dedicated run passed both tests in 14.063 seconds. Each mode covers a real browser mutation and 19 raw HTTP cases, including loopback aliases, Host mismatch, foreign/backend origins, spoofed ports, wrong schemes, malformed origins, forwarded-header spoofing, missing CSRF, and POST/DELETE without Origin. Valid no-Origin requests return 200; missing CSRF still returns 403.
- [x] Execute static/backend builds and full administrator/backend CSRF regression.
  Status: `npm --prefix admin run check` exited 0 with zero errors/ten existing accessibility/CSS warnings; `npm run build` exited 0. `node node_modules/jest/bin/jest.js --runInBand --silent test/admin test/security/req-12-csrf.test.ts` exited 0 naturally with eight suites/30 tests passed in 104.195 seconds. The final two additional DELETE assertions passed in the focused run above; source was unchanged after the combined regression.
- [x] Independent review and corrections.
  Status: PASS by `review_wave0`; real development/preview boundary tests passed. Proposed title: `fix: 개발 프록시에서 검증한 Origin만 백엔드에 맞게 전달`.
- [x] Commit, integration verification, remote verification, closure and Telegram report.
  Status: complete; operational evidence below.

## Evidence limits

Tests run actual local HTTP development and preview listeners, with scheme-spoof
rejection checks; they do not claim a new HTTPS deployment or change TLS settings.
The hook is limited to HTTP /api proxy middleware; existing WebSocket options are
retained without new WebSocket behavior claims. No-Origin forwarding preserves
existing semantics rather than treating an absent header as a new rejection.
Backend authentication/CSRF remains authoritative after adaptation. Node v24.16.0,
Svelte 5.57.0 and Vite 6.4.3 were used; hosted CI is not claimed.

## Operational completion

Integration commit: `21ea55a`. Independently observed pushed `origin/fix/epic-61` HEAD: `bf6b790832b838ee8e8bb528dc974dd0810795f9`. GitHub independently confirmed CLOSED at `2026-09-07T19:18:36Z`. Independent development/preview tests passed; broader local regression is recorded above. Hosted workflow execution is not claimed.

Telegram title: TDD Gate 67 Vite 개발 프록시의 Origin 불일치로 인증된 설정 변경 요청이 403으로 거부됨 (62/17). Successful message `3918` is from the orchestrator's tool receipt, not an independent Telegram fetch. Do not duplicate the notification.

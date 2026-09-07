# Issue #51 — Remove obsolete empty-key discovery

Status: ready to commit; both independent reviews and all scoped checks passed.
Original title: `/api/emptyKey` 엔드포인트가 라우팅되지 않아 최초 설정 안내와 비밀번호 강도 검사가 죽어 있음.
Assigned agent: `fix_ci14`; worktree `C:/Work/git/_Snoworca/TTTGate-epic61-ui`;
branch `fix/epic61-empty-key`; baseline `0e9ce88`.
Writable paths: LoginCtrl.isEmptyKey, Login's discovery-only onMount/state,
the dead AdminServer.onGetEmptyKey handler, the existing real login browser tests,
and this ledger. SessionStore.isEmptyKey and backend auth policy remain unchanged.

Root selected the issue's documented alternative: rely on bootstrapRequired from
the login response instead of restoring unauthenticated discovery. #8 already
implements that UI response contract. Reuse its isolated real backend process,
browser fixture and bootstrap flow; assert no discovery network call while setup
still succeeds and the old endpoint continues returning 404.

- [x] Read #51 and inspect existing discovery/bootstrap paths.
  Status: complete; #8 and #13 prerequisites are integrated and backend ownership is available.
- [x] Observe a real browser no-discovery regression before removal.
  Status: RED. `node node_modules/jest/bin/jest.js --runInBand --silent --runTestsByPath test/admin/login-bootstrap.test.ts -t 'obsolete discovery'` exited 1: one failed/seven unselected, 4.254 seconds. Bootstrap response UI completed setup and the old endpoint returned 404, but the browser recorded one unwanted /api/emptyKey request.
- [x] Remove only the obsolete caller/state and dead handler.
  Status: LoginCtrl's discovery method, Login's onMount/import/discovery state and the unused backend handler are removed. Bootstrap UI now depends solely on bootstrapRequired. SessionStore.isEmptyKey and endpoint 404 behavior are retained. Same focused command GREEN: one passed/seven unselected, 3.678 seconds.
- [x] Run focused, login/administrator and backend compatibility regressions plus builds.
  Status: static check exited 0 (zero errors/ten existing accessibility/CSS warnings), backend build exited 0. Related handle 4629 exited 0 naturally: four suites/18 tests passed in 61.133 seconds using `node node_modules/jest/bin/jest.js --runInBand --silent --runTestsByPath test/admin/login-bootstrap.test.ts test/admin/entrypoint.test.ts test/component/server/admin/AdminServer.security.test.ts test/unit/server/admin/SessionStore.security.test.ts`.
- [ ] Obtain both independent reviews, commit and hand off remote completion.
  Status: primary `review_wave0` and secondary `fix_supply15` code/content/title reviews PASS. Primary independently ran the actual no-discovery browser case: one test passed in 3.391 seconds with natural exit 0. Root authorized the scoped commit with exact title `fix: 최초 설정에서 폐기된 키 조회 제거`; root owns integration/push/close/Telegram.

# Issue #55 — Truthful test evidence policy

Status: documentation correction and both independent code/content/exact-title reviews PASS; frozen for root commit/integration. Owner fix_supply15/listeners fix/epic61-test-evidence-policy atd53ce84.
Original issue: https://github.com/ice3x2/TTTGate/issues/55. Approved research: main `epic61-issue-55-research.md`. Root selected the explicitly permitted policy-correction alternative, not rewriting the cited tests.

- [x] Read original/research and preserve mismatch evidence. Status: before evidence below; no behavior RED claimed.
- [x] Correct only blanket Jest comment and add current evidence guide. Status: three-file scope; runtime options and existing tests untouched.
- [x] Two independent original-issue/policy/diff/title reviews. Status: review_wave0 and fix_lint_diagnostics PASS, zero Critical/High/Medium/Low findings; root commit/integration pending.
- [ ] Root commit/integration/closure/notification. Status: pending.

Before evidence: jest.config.ts:4 stated `// 실환경 테스트만 허용(NO-MOCK).` while `test/unit/server/TunnelServer.keepalive.test.ts:11` uses `jest.spyOn(TCPServer, "create").mockReturnValue({} as any)` and asserts keepalive arguments. `test/unit/server/http/HttpHandler.rewrite.test.ts:96` injects an uncompressBody error and uses its declared MockSocketHandler. The client keepalive unit also substitutes SocketHandler.connect. These useful narrow unit contracts do not establish real native effects; the declaration was false. No demonstrably false descriptions adjacent to those tests were found, so none was edited.

The corrected comment points to `docs/guide/test-evidence-policy.md`. The dated guide permits pure/unit contracts with exact limits, distinguishes delegating observation, injected failure/mutation and actual I/O, and retains actual owned consumer evidence for transport/security/lifecycle acceptance. It preserves strict TDD and different-author review/fix loops, failure history and separate #48/#47/#54/#53/#52/#58 obligations. Historical plans and receipts are untouched. No test logic, Jest option, testMatch, coverage threshold, package or production behavior changes; no new RED/test execution is needed or claimed for these documents.

Search of current jest.config.ts, docs/guide and the three cited unit files found the single blanket declaration above; no extra writable file was added. The exact approved write set is jest.config.ts comment, this ledger and the new guide. Proposed title: `docs: 테스트 증거의 범위와 실제 통신 검증 기준 명시`.

## Independent review receipts

Root confirmed review_wave0 and fix_lint_diagnostics final original-requirement/content/exact-title PASS, zero Critical/High/Medium/Low findings. Neither reviewer executed tests. The scope is the permitted policy-correction alternative: one false blanket comment plus a truthful evidence guide and ledger; unit doubles/faults/observers/actual I/O limits and hard TDD/E2E/coverage/traceability gates remain. No new RED is required or claimed for this documentation-only change. Original history, test logic and Jest options are unchanged.
This entry changes only the ledger. Source comment/guide remain frozen; root commit/integration/closure/notification pending.

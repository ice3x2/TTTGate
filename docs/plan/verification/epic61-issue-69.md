# Issue #69 — Runnable binary archive layout

Status: RED, selected GREEN, two code/title reviews, actual pipeline, fresh native HTTP and two final artifact reviews passed; scoped commit authorized.
Original title: 바이너리 배포 아카이브의 디렉터리 구조와 웹 자산 누락으로 서버 실행과 관리자 화면이 실패함.
Owner fix_ci14; worktree C:/Work/git/_Snoworca/TTTGate-epic61-release;
branch fix/epic61-binary-layout; baseline 2106e48 (includes #34 at 6a94729).
Writable: binary archive helper, shared web validation extracted from #68/source
helper, binary instructions, dedicated tests/probe and evidence. Preserve #70
validation, original #65 flat archives and denied lint temporary directory.

- [x] Read original issue/runtime root and reuse. Status: packaged Environment root is executable/../..; bin/executable plus web matches existing producer. Reuse createArchive and extract #68 web validation.
- [x] RED regular archive/layout/web tests and actual preserved flat native archive. Status: binary-archives.test.ts exited 1 before implementation, six failed/two passed in 1.76s. It found flat executable members, missing web acceptance and old command paths. `node test/helpers/binary-runtime-probe.cjs TTTGate-v-issue65-verification-win-x64.zip results/release/issue69-native-red.json` then exited 1 before implementation: actual child 29752 exited 1 with ENOENT opening owned-parent bin/.pid_foreground; HTTP had no response. Original ZIP untouched; report/log retained.
- [x] Minimum binary layout and selected regression GREEN. Status: shared #68 web validation, exact bin/executable+web members and aligned instructions implemented. Same selected binary/source/version suite command exited 0 (handle 89957), 36 tests/three suites passed in 9.379s. Missing/empty index or referenced assets fail before all five outputs.
- [x] Coordinate one actual node deploy.js for latest #34 code/web/binaries. Status: root confirmed no backend heavy tests and authorized execution. Handle 86900 terminated with exit 0; log results/release/issue69-actual-pipeline.log. Full 97 suites passed/one skipped, 492 tests passed/four online skipped/496 total, 437.912s; final production admin build 2.89s then pkg 6.22.0 completed. Existing --forceExit remains, so this does not close #49 natural-exit cleanup.
- [x] Generate all five current archives, verify members/hashes and fresh Windows HTTP/assets. Status: archive generation handle 88905 exited 0. All five archives contain exactly their platform executable under bin plus four production web files; all extracted bytes/SHA match newly generated dist originals. Fresh Windows child 10800 served HTTP 200 HTML and matching JS/CSS, with runtime bin/.pid_foreground present. Probe exited 0; owned child cleanup was SIGTERM and awaited, not falsely described as natural server termination.
- [x] Two independent code/title and final artifact reviews. Status: primary review_cert_conflict and secondary review_wave0 PASS. Both independently checked all five latest archive members/original SHA and native HTTP/PID/asset evidence. Child cleanup is explicitly observed SIGTERM, not natural server termination.
- [ ] Scoped commit/root remote completion. Status: pending final actual evidence.

Final native verification must use newly generated binaries from this integrated
baseline, not earlier #65/#44 binaries. Original archives remain RED evidence.
No publication, production TLS weakening, or cross-platform execution claim.

Focused command: `node node_modules/jest/bin/jest.js --runInBand --silent
--runTestsByPath test/unit/tools/binary-archives.test.ts
test/unit/tools/source-archives.test.ts test/unit/tools/release-version.test.ts`.
The committed explicit Windows artifact probe is separate from ordinary Jest;
it runs against actual packaged bytes, uses owned temporary config/ports and
awaits only its child cleanup. HTTP tests use explicit test-only loopback
-allowLegacyAdminHttp. Flat-archive fallback in the probe is intentionally
retained to reproduce the original failure; it does not change production code.

Proposed exact title: `fix: 바이너리 아카이브에 실행 경로와 관리자 웹 자산 포함`.

## Latest actual release evidence

The full producer ran once on baseline 2106e48 including #34 commit 6a94729;
the new production JavaScript asset is index-CGtnnd6K.js (473354 bytes).
`node scripts/archive-binaries.cjs v-issue69-verification` created new names,
preserving all earlier #65 RED artifacts. The same committed native probe ran
against the new win-x64 ZIP and verified root discovery now selects the extracted
root, not its parent. All five archive members and actual native RED/GREEN facts
are recorded in [artifact evidence](epic61-issue-69-artifacts.json).
Raw local reports/logs remain under results/release/issue69-*. Old flat ZIPs,
logs and denied lint temp remain preserved and excluded from the commit.
Only three known test-generated tracked reports were restored to their prior
HEAD state after the full run; no source or artifact was restored/overwritten.

Windows bsdtar produced/extracted all archives and Windows x64 ran the actual
server. Linux/ARM execution and a hosted release are not claimed. No publication
command was used. Both independent reviewers approved these final results; root
authorized the nine-file commit and retains remote integration/closure ownership.

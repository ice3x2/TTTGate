# Issue #68 — Runnable source distribution

Status: complete; independently reviewed, committed, integrated, pushed, closed and notified.
Original title: 소스 배포 아카이브에 실행 JavaScript가 누락되고 안내 진입점이 불일치함.
Owner fix_ci14; worktree C:/Work/git/_Snoworca/TTTGate-epic61-release;
branch fix/epic61-source-archives; baseline ed79ee0.
Write scope: two release workflows and workflow README, source archive helper,
small shared archive-command extraction reused by binary helper, package-build
main metadata if approved, dedicated tests and evidence. Runtime source/TLS and
#69 binary layout are excluded. Prior artifacts and denied lint temp are preserved.

- [x] Read original issue, producer/manifest/runtime paths and reuse opportunities. Status: deploy already writes dist.js/app.js, package.json, web and empty bin. Both workflows archive dist and advertise src/app.js; runtime manifest main incorrectly says package.js.
- [x] RED actual wrong-source archive/entrypoint plus automated contracts. Status: actual baseline tar of dist and extraction (handle 42780) exited 1 because app.js/package.json are absent; archive/extraction retained under results/release/issue68-wrong-source.tar.gz and issue68-red-extract. Dedicated source-archives.test.ts exited 1 with 12 failures in 1.773s before implementation. Separate direct manifest main assertion also failed (package.js instead of app.js) before metadata edit.
- [x] Minimal source archive selection/validation and aligned instructions. Status: shared createArchive reuses #65 tar/ZIP commands; source validates app/manifest/runtime bin/index and referenced web assets, then archives dist.js. Both workflows/README now install runtime dependencies and invoke node app.js. Manifest main corrected after direct RED. Source/binary/version suites passed 32 tests in 4.453 seconds, exit 0.
- [x] Fresh isolated extraction/install/usage/server HTTP and asset evidence. Status: actual npm install --omit=dev exited 0 in fresh external temp, after confirming no node_modules at that directory or any ancestor. Node v24.16.0 usage exited 0; real server child 156324 served matching HTML and both referenced assets with HTTP 200, runtime bin/.pid_foreground existed. Owned child was terminated and its exit awaited in finally; no foreign process affected. Independent reproduction remains part of review.
- [x] Two independent reviews. Status: primary review_wave0 matched both archives' 141 files/SHA/runtime bin and HTTP asset evidence; secondary review_cert_conflict checked code, installation instructions, archive SHA and execution-evidence scope. Both approved the exact title.
- [x] Scoped commit and integration/push/closure. Status: complete; operational evidence below. #69 is the separate subsequent binary-layout task.

Dependency installation choice: the distribution has a dedicated package-build
manifest and no compatible distribution lockfile. Document npm install --omit=dev;
do not claim npm ci/reproducible resolution. This retains the existing manifest
ranges and Node >=24 policy without introducing a second generated lockfile.
No producer change is currently required; reuse reviewed #44 actual dist.js and
production web for actual archive evidence. No duplicate pkg generation/publication.

## Actual artifacts and runtime

Only changed manifest output was regenerated using the existing producer's
package-build.json -> dist.js/package.json copy. Compiled code/production web
from reviewed #44 remains unchanged. `node scripts/archive-source.cjs
v-issue68-verification` exited 0 and generated actual tar.gz and ZIP distributions.
Both were extracted and every source file's SHA256 compared, including app.js,
manifest and web; runtime bin directory is retained. Detailed intentional
evidence: [artifact and runtime JSON](epic61-issue-68-artifacts.json).

Fresh tar extraction: C:/Users/beom/AppData/Local/Temp/tttgate-source68-Qaye5R.
Install log: results/release/issue68-fresh-install.log. Native log and facts:
results/release/issue68-native.log and issue68-fresh-runtime.json. NODE_PATH was
cleared; source cwd is the runtime root. Test-only loopback HTTP used explicit
-allowLegacyAdminHttp and temporary config/ports 63945/63946; production TLS and
authentication defaults remain unchanged. Usage output alone is not the HTTP
evidence: GET / matched production HTML and JS/CSS bytes/hash matched disk.
Windows tar/ZIP extraction and local Node runtime were executed; no hosted
workflow/publication or Linux/ARM runtime is claimed. #69 was still open at this verification checkpoint; see its separate later completion record.

Proposed exact title: `fix: 실행 가능한 소스 배포 아카이브와 안내 경로 일치`.

## Operational completion

Source commit `5dc39e9357aa64796aa41ff8328f047f5d466ae9` was integrated as `2106e48ab6544ccf4b64db0f456dc927eafa6c79` and pushed to `origin/fix/epic-61`; root observed the matching remote hash. Root integration ran source-archives, binary-archives and release-version tests: three suites/32 tests passed in 4.103 seconds, natural exit 0. GitHub reported CLOSED at `2026-09-07T23:31:44Z`.

Telegram title: `TDD Gate 68 소스 배포 아카이브에 실행 JavaScript가 누락되고 안내 진입점이 불일치함 (66/29)`. Delivery message 3937 is the root tool receipt, not an independent Telegram fetch. Do not resend. #69 and the overall epic remain incomplete.

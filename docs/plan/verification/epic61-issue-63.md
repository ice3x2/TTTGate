# Issue #63 — Node 24 minimum and binary runtime

Status: complete; independently reviewed, integrated, pushed, closed and notified. Timing outcomes remain FAIL/INCONCLUSIVE, with no physical constant-time proof claimed.
Assigned agent: `fix_supply15`; branch `fix/epic61-node24`.
Worktree: `C:/Work/git/_Snoworca/TTTGate-epic61-node24`; base `d8cb6a7`.
Writable paths: root/admin/distribution package manifests and lockfiles, runtime
version fields in workflows/deploy documentation, `.nvmrc`, README runtime
guidance, `test/ci/node24-runtime.test.ts`, `test/fixtures/node24-runtime-probe.cjs`,
and this ledger. Runtime/tunnel behavior and #44 archive fixes are outside this lane.

- [x] Read #63, ADR-011 and prior packaging code; research supported tooling. Status: complete; reuse existing pkg CLI flags and five-platform target list, existing Jest/YAML tooling and build commands.
- [x] Write runtime/manifest/workflow/package contracts before implementation. Status: RED; nine tests failed before any implementation change.
- [x] Run old pkg against a real Node 24 executable fixture before replacement. Status: RED; pkg 5.8.1 exits 1, `No available node version satisfies 'node24'`.
- [x] Upgrade minimum versions, declarations, locked packaging tool and CI. Status: complete; minimum >=24.0.0, @types/node 24.13.3, TypeScript 5.9.3, @yao-pkg/pkg 6.22.0; nine contracts pass.
- [x] Clean install, build, root/admin regression. Status: final forced build and ordinary regression pass (75 suites/372 tests, four online skips); earlier timing failures preserved below and separately resolved as experiment-methodology issue #64, not relabeled as passing.
- [x] Generate all five real app binaries, inspect architectures and run Windows x64 product plus runtime probe. Status: final regeneration after #9/#66 and TypeScript 5.9.3 emit passes; final checksums below.
- [x] Independent review and corrections. Status: PASS by `review_wave0`; final source, forced-build and artifact review complete.
- [x] Integrate, push, close and notify. Status: complete; operational evidence below.

## Primary-source research

`npm view @yao-pkg/pkg version engines repository --json` returned version 6.22.0,
Node >=22. Its dependency metadata pins `@yao-pkg/pkg-fetch` 3.6.5. The actual npm
3.6.5 tarball's `patches/patches.json` selects Node 24.18.1; its expected SHA map
contains Alpine x64, Linux x64/ARM64 and Windows x64/ARM64. The live GitHub
release API for `yao-pkg/pkg-fetch` confirms corresponding v3.6 release assets.

- [Maintained fork migration](https://yao-pkg.github.io/pkg/guide/migration): CLI/config compatibility and Node 24 support.
- [Target and cross-compilation support](https://yao-pkg.github.io/pkg/guide/targets): standard Node 24 mode, source-public/no-bytecode cross-architecture builds and Alpine target.
- [Exact packaged runtime hashes](https://github.com/yao-pkg/pkg-fetch/blob/v3.6.5/lib/expected-shas.json): expected platform/runtime assets.
- [Node release schedule](https://github.com/nodejs/Release): Node 24 Active LTS, planned EOL 2028-04-30.

Retain standard mode and `--no-bytecode --public-packages "*" --public`, avoiding
an unnecessary SEA/VFS migration. No silent Node 18 fallback or platform removal.

## RED commands

```powershell
node node_modules/jest/bin/jest.js --runInBand --runTestsByPath test/ci/node24-runtime.test.ts
node node_modules/pkg/lib-es5/bin.js test/fixtures/node24-runtime-probe.cjs --targets node24-win-x64 --output dist/node24-runtime-probe.exe --no-bytecode --public-packages '*' --public
```

First command: exit 1, nine failed tests (undeclared engines, old types/tooling/
targets/workflows, missing `.nvmrc` and runtime guidance). Second command: exit 1
with the unsupported Node 24 diagnostic above. The probe checks its embedded
runtime major, snapshot source readability and SHA-256 support.

Initial locked installs: root 536 packages and admin 106 packages, both exit 0.
Local host Node 24.16.0 on Windows. Cross-platform execution and hosted workflow
runs are not proven by tooling metadata or file-header inspections.

## Build and regression execution

After lockfile updates, `npm ci --no-audit --no-fund` completed with 581 root
packages (handle 55235, exit 0); the same command in `admin/` installed 106
packages (exit 0). One premature build while root installation was still live
reported missing rimraf declarations; after observing install completion,
`npm run build` exited 0. That result was incremental, not proof of a cold/forced
build: later source changes exposed declaration/compiler incompatibility. The
forced RED/GREEN repair below supersedes the earlier build-readiness inference.
No compiler options were weakened.

`npm run build` in `admin/` exited 0 (existing accessibility/bundle-size warnings).
`npm --prefix admin test` exited 0 without forced termination: two suites/three
tests passed, 5.408 seconds (handle 72379).

`npm test -- --runInBand` (handle 55877) exited 1: 70 suites passed, one failed,
one online-only suite skipped; 318 tests passed, one failed, four online tests
skipped, 323 total; 187.628 seconds. Sole failure:
`test/unit/util/req-04-timing-safe-string-equal.test.ts`, microbenchmark expected
bias <7%, received **15.779504434027428%**. Packaging ran concurrently during part
of this full run. This evidence is retained; the suite is not claimed green.

One focused rerun after packaging finished:

```powershell
node node_modules/jest/bin/jest.js --runInBand --runTestsByPath test/unit/util/req-04-timing-safe-string-equal.test.ts
```

Handle 51349 exited 0: 10 tests passed, 8.686 seconds; measured bias
**1.5243764193431324%** with the unchanged 7% threshold. No timing implementation,
benchmark test or threshold was edited. This variation alone does not establish
the cause of the original failure; the orchestrator/reviewer owns disposition.
Test-generated tracked reports were restored to the lane baseline afterward.

## Initial binary generation and execution (superseded pending final rebuild)

`npm run pkg` (handle 79629) exited 0 using pkg 6.22.0 and generated all five
real application executables below. No target was dropped. Artifacts remain in
the ignored `dist/bin/` directory of this worktree; they are not source commits.

| File | Bytes | Header architecture | SHA-256 |
| --- | ---: | --- | --- |
| TTTGate-alpine-x64 | 83787927 | ELF x86-64 (0x3e) | 0a3ce2137bd3d64488560f04ef85e5c3863f4440c677dc296188c5174f19c9e3 |
| TTTGate-linux-arm64 | 71721487 | ELF AArch64 (0xb7) | ba4a0d98f0185d0ccb175e5dec3a83ce13288c365c94bceef308a5d9defbc5fe |
| TTTGate-linux-x64 | 77689687 | ELF x86-64 (0x3e) | b802890c0d40de9a02e5e27ae8d5ddd3660f21dfde98ef7fc94338b7263395df |
| TTTGate-win-arm64.exe | 90291859 | PE ARM64 (0xaa64) | f423d90c2e42fcd49a52df7af019924228c643cfed7e6abe79ecb73cfde3c82d |
| TTTGate-win-x64.exe | 96003219 | PE AMD64 (0x8664) | c48b37f8286cfc992a5f0d45b6e70b919cc1a62453c8af317c0bc6633411464f |

The old failing probe command was repeated with the maintained CLI:

```powershell
node node_modules/@yao-pkg/pkg/lib-es5/bin.js test/fixtures/node24-runtime-probe.cjs --targets node24-win-x64 --output dist/node24-runtime-probe.exe --no-bytecode --public-packages '*' --public
```

Build exited 0. Running `dist/node24-runtime-probe.exe` exited 0 and returned:

```json
{"node":"24.18.1","platform":"win32","arch":"x64","packaged":true,"sourceReadable":true,"sha256":"d049666b78fca8bba8e24ba2b8d8691f1ddfdb2c5421e0941675ccda2b914d53"}
```

Execution checks asserted Node major 24, win32/x64, `packaged === true`,
`sourceReadable === true`, and SHA-256 equal to the hash of `TTTGate`; merely
printing these fields was not treated as proof. Header checks asserted magic
bytes and machine fields for each file. `review_wave0` independently repeated
these assertions and all five checksums.

Running `dist/bin/TTTGate-win-x64.exe` with no arguments from `dist/` exited 0
and printed `TTTGate v1.0.11b (20250117)` plus
`Usage: TTTGate [server|client] [options]`. This executes the actual packaged
product and loads its dependencies; it does not claim packaged tunnel E2E.

## Platform execution limits and release handoff

Only Windows x64 binaries were executed here. ELF/PE headers and checksums prove
generated files/architectures, not successful execution on the other four
platforms. #44 must run Linux x64 on `ubuntu-24.04`, Linux ARM64 on
`ubuntu-24.04-arm`, Windows ARM64 on `windows-11-arm`, and Alpine x64 in an Alpine
container with its runtime libraries. Generate the same runtime probe for each
target, assert major/platform/architecture and run product smoke checks before
publishing. [GitHub runner reference](https://docs.github.com/en/actions/reference/runners/github-hosted-runners)
documents the native runner labels. No cross-platform run or hosted workflow
execution is claimed by this ledger.

The existing release workflow looks under `dist/tttgate-*` while packaging emits
`dist/bin/TTTGate-*`; this predates the migration and was reported to the root for
release-gate disposition. This lane changes runtime/tool versions only and does
not mark the archive/release path ready.

## Forced compiler compatibility repair

After #66 changed source, build handle 18168 failed in the Node 24 declarations.
Explicit `npm run build -- --force` reproduced RED with TypeScript 5.1.6:
`Disposable`, `Symbol.dispose`, `Symbol.asyncDispose` and `esnext.disposable`
were unavailable. The installed `@types/node@24.13.3` package metadata declares
`typeScriptVersion: "5.6"`. Primary `npm view typescript@5 version --json` listed
**5.9.3** as the latest 5.x version; root and admin now use `^5.9.3`, locked to
5.9.3, without a TypeScript 6 upgrade.

The next forced build (handle 13190) still failed on five MapIterator declaration
errors from `lru-cache@10.4.3` under path-scurry. TypeScript `--explainFiles`
identified `rimraf/dist/mjs/index.d.ts` as an implicit type-library entry, which
pulled glob/path-scurry/lru-cache declarations. The repository source does not
import rimraf. The installed deprecated `@types/rimraf@4.0.5` package describes
itself as a stub because rimraf supplies its own declarations. Removing only
this unnecessary stub removes the implicit entry; the real rimraf deployment
dependency and all other stub packages remain. No transitive runtime major was
upgraded and `skipLibCheck` remains false.

Repair commands:

```powershell
npm install --save-dev 'typescript@^5.9.3' --package-lock-only --no-audit --no-fund
npm --prefix admin install --save-dev 'typescript@^5.9.3' --package-lock-only --no-audit --no-fund
npm uninstall --save-dev @types/rimraf --package-lock-only --no-audit --no-fund
npm ci --no-audit --no-fund
npm --prefix admin ci --no-audit --no-fund
npm run build -- --force
```

Root final locked install handle 25689 exited 0 (580 packages); admin locked
install handle 14651 exited 0 (106 packages). Final **forced build exited 0**
(8.300 seconds). A subsequent Node assertion imported the freshly emitted helper,
confirmed odd hex rejected/even hex accepted, and imported the timing classifier
script successfully. Independent workers were notified when installation ended;
their attempts during the install that saw missing Jest are environment races,
not attributed to application changes or counted as RED evidence.

The earlier checksums above are explicitly initial artifacts, not final binaries
containing the later #9/#66 source and TypeScript emit changes.

## Final sequential verification

After the independent #64 diagnostic ended, run order was strictly build →
full Jest → five-target packaging → native artifact checks. No timing experiment
or packaging process ran concurrently with this full Jest run.

1. `npm run build -- --force`: handle **45821**, exit 0.
2. `npm test -- --runInBand --silent`: handle **16537**, exit 0; **75 suites and
   372 tests passed**, one online-only suite/four online tests skipped, 376 total
   tests, 228.365 seconds. This includes integrated #9 and final #63/#64/#66 tests,
   administrator browser tests, and the unchanged 12% UTF-8 benchmark.
3. `npm run pkg`: handle **33884**, exit 0, all five real application binaries
   regenerated from the final emitted source.
4. Repeated the maintained-tool Windows x64 probe build command above, exit 0;
   Python execution/assertion checks for every header, hash, native product and
   probe also exited 0.

Final files under `dist/bin/`:

| File | Bytes | Header architecture | SHA-256 |
| --- | ---: | --- | --- |
| TTTGate-alpine-x64 | 83789346 | ELF x86-64 (0x3e) | 588271e88e878b3d6372aa803c96dd6188ce26fe5c440c4249da002c2d5f68ec |
| TTTGate-linux-arm64 | 71722906 | ELF AArch64 (0xb7) | 6e2f294c3d27aeb52f2738d458efab88de209d5b2b413c6365809eca9c1c8aa2 |
| TTTGate-linux-x64 | 77691106 | ELF x86-64 (0x3e) | 778341266c74498f395a40a47a44fd92c540b22c922a8555e9c54bf8aa228bb9 |
| TTTGate-win-arm64.exe | 90293278 | PE ARM64 (0xaa64) | 856a7d84ba8529d15e69f87ca7b11091eebf16826c548ac14756ce740e029cb8 |
| TTTGate-win-x64.exe | 96004638 | PE AMD64 (0x8664) | 8907305b5409b1c0e9f421d58e949735764534b955a4c13ea48760bb85b1e442 |

Fresh Windows product execution exited 0 with version `1.0.11b` and usage text.
Fresh probe execution exited 0 with Node **24.18.1**, win32/x64,
`packaged: true`, `sourceReadable: true`, and the expected SHA-256 of `TTTGate`.
All fields were asserted, not just printed. Cross-platform execution limits
and #65/#44 archive handoff remain as documented above.

The latest independent #64 timing experiment is **INCONCLUSIVE**. Its evidence,
earlier failed observations and independent methodology disposition are in the
#64 ledger owned by its separate fixer. Ordinary test success is not presented
as physical timing-safety proof. No further timing measurements were run here.
Test-generated tracked reports were restored; unique diagnostic reports and
the committed raw evidence copies remain intact.

## Operational completion

Integration commit and independently observed pushed remote HEAD: `b093dce3dcd945833dc46ac490b099970dd6507a`. GitHub independently confirmed CLOSED at `2026-09-07T16:26:23Z`. Root reports clean root/admin installs, forced compilation and eight suites/66 focused integration tests passed in 27.951 seconds after cherry-picking.

Telegram title: `TDD Gate 63 최소 Node.js 사양을 24 LTS로 올리고 CI·배포 런타임 통일 (61/7)`. Successful delivery message `3902` is from the orchestrator's tool receipt, not an independent Telegram fetch. Do not duplicate the notification.

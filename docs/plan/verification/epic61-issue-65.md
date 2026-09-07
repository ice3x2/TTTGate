# Issue #65 — Exact binary release archives

Status: archive collection and primary final evidence review passed; root authorized scoped commit. Separate #68/#69/#70 remain open.
Original title: 릴리스 워크플로우가 실제 바이너리 경로와 다른 이름을 찾아 아카이브를 누락함.
Owner: fix_ci14; worktree C:/Work/git/_Snoworca/TTTGate-epic61-release;
branch fix/epic61-binary-archives; baseline c064c53.
Writable: deploy.js, binary release workflow, one narrow archive helper,
dedicated tests and this ledger. Source archive layout/entrypoint #68 remains
a separate checkpoint. Existing actual binaries and lint temp are retained.

- [x] Read original issue, workflow/deployer/manifest and reuse candidates. Status: no shared archive helper exists; current Ubuntu workflow already uses tar/zip. Actual Node24 outputs are five TTTGate-* files under dist/bin.
- [x] Observe exact-name/missing/empty/archive-content and binary-skip RED. Status: handle 6062 exited 1; 5 failed/9 passed, two suites, 33.96 seconds. Command: node node_modules/jest/bin/jest.js --runInBand --silent --runTestsByPath test/unit/tools/binary-archives.test.ts test/unit/tools/deploy-gates.test.ts. New archive helper is absent, current workflow still duplicates pkg, and the real npm fixture records pkg despite --skip-binaries. Existing nine gate tests passed. The retained dist.js manifest also emits a nonfatal Jest haste collision warning; it is not counted as functional RED and source output is preserved for #68.
- [x] Implement and run focused GREEN. Status: same command handle 45111 exited 0 naturally, 14 tests/two suites passed in 39.462 seconds. Archive subprocess tests use actual tar/ZIP tools and recover original fixture bytes; missing and empty last binaries fail before any archive appears. Existing nine gates and explicit skip fixture pass. No npm dependency added.
- [x] Archive retained actual five binaries and independently verify bytes/hash/native execution. Status: review_wave0 independently confirmed all five archive members, sizes and hashes match original/extracted files and evidence JSON. Actual native server diagnosis found the separate #69 layout defect below; native server usability is not marked PASS. No duplicate pkg run performed.
- [x] Two independent reviews. Status: primary review_wave0 and secondary fix_supply15 code/content/exact-title PASS; primary final artifact review additionally covers the intentional seventh file, archive evidence JSON.
- [ ] Scoped commit and integration/push/closure. Status: root authorized the seven-file commit; remote operations remain root-owned.

Tool decision: use existing tar/zip on Ubuntu, Windows built-in bsdtar for ZIP
creation (host tar.exe reports bsdtar 3.8.4). No npm dependency is required.
The [official bsdtar manual](https://github.com/libarchive/libarchive/blob/master/tar/bsdtar.1)
documents ZIP creation. Commands use fixed argument arrays and explicit cwd.
Helper input paths follow the package output contract; all five inputs are
validated before archive creation, and absent/empty archives fail before upload.
The optional build_binaries=false maps to explicit deploy --skip-binaries;
default builds exactly once. Missing uploads must fail instead of silently skip.

Actual retained binaries came from #44's reviewed successful full pipeline.
Fixture archive tests are distinct from actual artifact verification. Native
execution is limited to this Windows x64 host; cross-platform contents and file
formats do not establish Linux/ARM runtime execution.

## Actual retained artifact evidence

`node scripts/archive-binaries.cjs v-issue65-verification` (handle 62914) exited
0, producing all five nonempty archives. Log: results/release/issue65-actual-archives.log.
Actual tar listing and extraction found one exact intended binary per archive;
each extracted size and SHA256 matched its retained dist/bin original.
The intentional [evidence JSON](epic61-issue-65-archives.json) records both hashes,
archive hash/size and native headers. Extracted files remain under
results/release/issue65-extracted for independent native review.
Windows bsdtar 3.8.4 produced all actual archives; the existing Linux tar/zip
branch is not claimed as locally executed. No archive was published.

Proposed exact title: `fix: 실제 바이너리 경로로 릴리스 아카이브 생성`.

## Independent final review and remaining release defects

Primary review_wave0 approved the archive collection fix and independently checked
all five archive streams/members/sizes/hashes against retained originals,
extracted files and this evidence JSON. This PASS is limited to #65 collection.

Native Windows server execution from the unchanged flat archive exited on a
missing parent-derived bin/.pid_foreground path. A separate diagnostic supplying
only that directory reached HTTP but returned GET / 404 without web assets.
This is tracked in #69; prior usage/startup checks never established administrator
UI functionality. #68 source archive layout/entrypoint and #70 workflow version
shell interpolation are also open. No overall release-ready claim is made.
The tracker now has 65 issues, 25 completed before #65 integration/closure.
Root retains integration/push/closure ownership. No #68/#69/#70 code is included.

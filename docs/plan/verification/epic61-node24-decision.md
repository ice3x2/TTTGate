# Minimum Node.js version decision

Status: accepted user-directed change; implementation pending. Date: 2026-09-08 KST.

The user explicitly requested replacing the Node.js 18 minimum with either 22 or 24 LTS and delegated the selection. Select Node.js 24 LTS. The official release schedule lists Node 24 as Active LTS with support through 2028-04-30, while Node 22 is Maintenance LTS ending 2027-04-30. This gives the project a longer supported baseline; current local verification already uses Node 24.16.0.

Sources: [Node.js release schedule](https://github.com/nodejs/Release), [Node.js 22 to 24 migration guidance](https://nodejs.org/en/blog/migrations/v22-to-v24).

## Required work

- [ ] Declare Node.js >=24.0.0 consistently in runtime, admin and distributed package manifests, with clear installation guidance. Status: pending.
- [ ] Run all CI/release/audit workflows on Node.js 24 and align Node type declarations/lockfiles. Status: pending.
- [ ] Replace Node 18 binary packaging targets/tooling with a supported Node 24 solution; verify actual artifacts and preserve intended platforms where technically supported. Do not merely rename unsupported pkg targets or silently continue embedding Node 18. Status: pending packaging research.
- [ ] Write failing version/build/distribution contract tests before changing configuration, then validate clean install, build, test and packaging. Status: pending.
- [ ] Independent review, commit, push, close and Telegram report. Status: pending.

## Scheduling

Parent epic #61; this supersedes the old Node 18 support assumption prospectively. Completed #62 remains a valid repair of the then-current build baseline; this new requirement deliberately changes the baseline afterward. Serialize root manifests and workflows with the active #50 admin harness worker. Implement the remaining runtime migration as serial issue #63 after #50/#17 integration and before #5 resumes (therefore also before #44 final release gates); independent packaging research may run in parallel. Record any unsupported platform as an explicit finding, not a silent scope reduction.

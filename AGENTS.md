# TTTGate Agent Guide

## Project Summary

TTTGate is a server-client tunneling project that forwards external traffic to internal services and includes a web admin UI for configuration and operations.

Repository shape at a glance:

- `src/server`: server-side tunnel, session, certificate, and admin-facing runtime
- `src/client`: client-side tunnel connection and endpoint connection management
- `src/commons`: shared control packets, certificates, and monitoring utilities
- `src/util`: socket, buffer, file cache, CLI, and low-level helper code
- `admin/`: admin web UI

The repository already contains analysis and fix reports around stability and backpressure. Future work in this repository should continue with a clear focus on improving security issues and usability without casually breaking existing tunnel behavior.


## Reuse-First Rule

Avoid duplicate code.

Before implementing any new class, method, transport primitive, protocol parser, cache logic, session logic, admin flow, or utility:

- search this repository for an existing implementation that can be reused or extracted
- prefer refactoring shared code into a reusable component instead of copying logic
- document any intentional duplication if it is truly unavoidable

New code must not be added until reuse opportunities have been checked first.


## Planning Rule

Every plan document must:

- be stored as a Markdown file
- contain checkboxes for actionable items
- contain a status line for each checklist item
- be updated when a phase completes, is blocked, or changes state
- remain accurate enough that work can resume after a session reset from the last completed step

Agents must consult any existing plan or analysis document before starting or resuming substantial implementation work.


## Change Rules

Any agent working in this repository must follow these rules:

- do not break the existing CLI, config, admin API, or tunnel control/data flow without a documented reason
- do not silently weaken authentication, TLS, or certificate handling defaults
- do not hide transport, protocol, or session lifecycle errors that should surface to operators or callers
- do not mix unrelated concerns into the core tunnel path more than necessary
- do not add new code before checking whether an existing implementation can be reused or extracted

Preferred approach:

- keep public behavior predictable for existing users
- keep the internal implementation explicit, debuggable, and maintainable
- prefer small, well-scoped changes over broad rewrites


## Mandatory Review Loop

At the end of every implementation phase, a strict review must examine the result.

The review process is mandatory:

- implement the phase
- review the result with a strict, detail-oriented mindset
- capture the review findings
- apply the fixes
- review again
- repeat until there are no material findings or an explicit unresolved tradeoff is documented

The reviewer should behave like a picky and skeptical senior code reviewer:

- prioritize correctness, security, maintainability, duplication, and test gaps
- challenge weak abstractions and unnecessary complexity
- flag code that should be reused instead of duplicated
- require plan and documentation updates when work changes scope or status

This loop applies to code, tests, and significant design or planning documents.


## Security Requirements

Security improvements are required unless compatibility or operations explicitly require otherwise.

Defaults should be:

- authentication enabled where the feature supports it
- certificate or peer verification enabled where applicable
- no blanket trust-all behavior
- no silent downgrade to unsafe behavior

If insecure behavior is needed for interoperability or recovery, it must be:

- explicit
- isolated
- documented
- off by default


## Quality Bar

This repository should be developed as a serious networked application, not a demo.

Required verification areas:

- unit tests for packet handling, config loading, buffer management, cache behavior, and session lifecycle
- integration tests for server/client connection setup, reconnect behavior, tunnel data flow, and admin API behavior
- leak and lifecycle tests for sockets, file cache, and long-lived sessions
- regression tests for any bug fix that affects stability, security, or compatibility

Jest is configured in the repository, but automated test coverage is still thin. Non-trivial changes should add tests where feasible or clearly document the gap.

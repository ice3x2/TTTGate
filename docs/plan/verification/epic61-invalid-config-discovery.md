# Discovery #72: invalid existing server configuration enters default-save startup

Status: #72 complete; source5ba80f6 -> maina64a901f138dc2831d0006b8a107d8d321458490 pushed/remote verified; eight suites76testsPASS179.243seconds naturalexit0/forcedbuildPASS; CLOSED2026-09-08T11:54:00Z comment5584718146 Telegram3989(67/56). Original static discovery/API/assignment statements below are historical; execution/ledger72 hold current completion evidence. #18 exact design approved and assigned review_cert_conflict/process fix/epic61-session-idle-policy ata64a901.

- [x] Inspect original Store, File/Files and ServerApp startup paths. Status: static facts below.
- [x] Independent static review/root issue registration. Status: PASS; root registered https://github.com/ice3x2/TTTGate/issues/72. This document is not implementation authorization.
- [x] Observe owned-child RED under the frozen result/startup refusal contract. Status: completed; original and independent correction evidence preserved in ledger72.
- [x] Implement minimum Store/ServerApp repair and regressions. Status: complete through root integration/closure/receipt3989; original scope and failed-run evidence remain historical.

## Observed source facts and limits

ServerOptionStore.ts:227 uses `!this._configFile.isFile() || !this.load()` for one
branch which creates default options, resets revision state and calls save().
File.isFile (:275) catches every stat failure as false, conflating absence with
non-file/inaccessible/error states. Files.toStringSync (:105) returns undefined
when canRead is false; otherwise readFileSync may throw. Store.load (:256) assigns
parsed YAML directly to _serverOption before verifying server and tunneling rows;
validators may mutate that published object. Empty content leaves no valid candidate;
syntax/read/validation failures return false (or are caught and then return false).
Thus malformed YAML, empty content and invalid schema reach the default-save branch.
Existing revision-state values are also replaced on that branch before save().

Non-file targets and stat/read errors likewise attempt default creation/save, but
successful on-disk replacement is NOT established for those cases: a directory,
permissions or atomic rename can itself prevent writing. Do not claim every category
was successfully overwritten or that actual runtime reproduction occurred. The
static defect is failure to distinguish missing from invalid/unreadable/non-file,
and routing all categories into a potentially destructive persistence path.

ServerApp.start (:69-87) obtains stores, handles explicit reset, loads certificates,
applies CLI startup option mutations, then evaluates admin security and starts
listeners. Store default-save occurs during singleton construction before those
steps. AppCompositionRoot.serverStores (:26) constructs ServerOptionStore first;
CertificationStore constructor currently only reads revision state, while its
load is later. There is no explicit config-load refusal gate before certificate
load/CLI writes/listener startup. Existing admin security rejection does not restore
configuration overwritten earlier. No authentication or option policy change is
required to fix this ordering.

## Proposed issue body

Title: `fix: 잘못된 기존 서버 설정을 보존하고 시작 거부`

Existing server configuration load failures are treated as first startup: the store
creates defaults and attempts to save them, resetting persisted revision metadata.
A parsing/validation failure can also publish a partial candidate internally before
load reports failure. An operator correcting a bad file can lose the original
configuration instead of receiving a startup error.

Separate truly missing configuration from an existing invalid/unreadable/non-file
path. Create and persist defaults only for confirmed absence. Validate parsed data
locally and publish only a complete successful candidate. Return a bounded explicit
load status for predictable invalid input. Refuse normal startup before certificate
load, CLI option persistence and any listener start when existing configuration
cannot load, preserving configuration and revision-state bytes. Keep intentional
explicit reset behavior, with its existing authorization/CLI semantics, intact.

Evidence status: static source diagnosis only; actual reproductions and RED must be
collected after approved assignment. This is a separate prerequisite for #18 because
adding a rejected TTL value to current validation would otherwise trigger the same
existing overwrite path. No #40 memory-limit decision is made by this issue.

## Proposed minimal API and write boundary

Initial production writes: ServerOptionStore.ts and ServerApp.ts only, plus dedicated
owned-child fixture/tests/ledger. No File/Files, certificate, listener, YAML library,
wire, buffer-policy or TTL behavior change. Reuse existing validators/atomic writes,
reset and startup flow; avoid a second parser or persistence abstraction.

Suggested store load status: discriminated result with ready/missing-default-created/
invalid and a bounded reason such as read-error/non-file/empty/parse/validation.
Use status to distinguish invalid from missing, not a new thrown validation error.
Retain native unexpected I/O failures as failures with context; do not silently
convert them to missing. Detect ENOENT specifically when checking existence; other
stat errors are not permission to save. Existing YAML parsing error boundary may
report invalid parsing without logging raw secret-bearing YAML/parser snippets.
Use a local candidate through all validation before assigning _serverOption or
revision metadata. Existing valid loaded revision identity remains intact.

ServerApp reads the status and honors explicit reset before refusing invalid normal
startup; the gate must precede certStore.load, applyStartupOptions and startService.
Missing config remains normal first-run initialization. Explicit reset may intentionally
replace config, but invalid normal startup must not trigger or emulate reset. Freeze
how a non-ready store exposes serverOption before implementation so no placeholder
default becomes accidentally writable; callers of prepare/commit/save must fail
explicitly while invalid unless an explicit reset succeeded. No public startup API
redesign is assumed without review.

## Owned actual RED and acceptance plan

- [ ] Byte-preservation RED. Status: use newly created owned temporary roots with real malformed YAML, zero-byte YAML, invalid server/tunnel schema and a distinct existing revision-state fixture; snapshot exact bytes before invoking the actual Store/ServerApp in an owned child. Assert failure is surfaced, bytes unchanged, no defaults/revision writes, no certificates/listeners/CLI override writes. Native child exits naturally; capture diagnostics outside the exercised config root.
- [ ] Failure category controls. Status: directory at config filename is a real non-file fixture; demonstrate refusal without deletion/replacement. Use owned read-denied file only when platform permissions can be safely established and restored, otherwise disclose a scoped read/stat fault injection separately. Do not claim injected EACCES as OS reproduction or touch existing denied test paths.
- [ ] Publication control. Status: valid top-level YAML with a later invalid tunnel row must not publish the partially validated option/revision; inspect explicit status and refusal before any dependent consumer. No raw secrets in logs.
- [ ] Positive controls. Status: true missing file creates defaults once; valid file/revision loads unchanged and normal startup works; authorized explicit reset still works; valid startup CLI overrides and admin security rules retain behavior. Preserve #35/#71 commit/recovery tests and #40 existing values without new interpretation.
- [ ] Startup ownership proof. Status: child uses actual ServerApp entrypoint with delegated observers for cert load/CLI persistence/listen, requiring zero calls on rejected input. If a sentinel callback guard/injection is needed, disclose it rather than claim real listener binding. Actual successful startup controls use only owned ephemeral sockets and explicit shutdown.

No live processes were started for this research. Never terminate all node.exe;
any later cleanup termination requires verified task PID, current command line and
ownership. Root reviews/publishes the issue and authorizes implementation separately.
## Registered #72: proposed exact non-ready API freeze

Status: root registered https://github.com/ice3x2/TTTGate/issues/72. API approved and implementation assigned above; actual RED precedes source. Existing public callers were inspected in Store,
ServerApp, TTTServer and AdminServer; no source/test execution.

Proposed additive API:

```ts
type ConfigLoadStatus =
    | {ready: true; source: 'loaded' | 'created' | 'reset'}
    | {ready: false; reason: 'non-file' | 'read-error' | 'empty' | 'parse' | 'validation'};
get loadStatus(): ConfigLoadStatus;
readServerOption(): {success: true; serverOption: ServerOption}
    | {success: false; message: string};
```

Return detached status/options; no placeholder defaults on a failed load. Only
confirmed missing file constructs defaults. Invalid input is a result, not a new
normal throw/catch branch. Root approved the explicit legacy getter invariant:
keeping `get serverOption(): ServerOption` while representing a genuinely non-ready
store cannot safely return a value without either a placeholder, a lying undefined
cast, an optional type or an invariant error. Recommended compatibility boundary:
keep that getter for ready-only legacy callers and throw a bounded programming-
invariant error only if an unguarded caller violates its readiness precondition.
The normal invalid-config startup path uses loadStatus/readServerOption and never
calls/catches the getter. This is not an exception used to classify bad YAML; do not
broaden it beyond this root-approved invariant boundary. If all
exceptions even for caller misuse are disallowed, the honest alternative is widening
the getter and updating callers, which exceeds the proposed two-file scope.

ServerApp obtains the store, handles explicitly authorized reset, then calls the
result accessor. On failure report the bounded load diagnostic and return a failed
startup through existing application shutdown/error reporting conventions before
certStore.load, CLI overrides, admin security evaluation or listeners. Do not
invoke serverOption on that path. After successful reset/load, existing startup
callers may continue with the ready getter; re-read after CLI mutations as today.
CertificationStore construction currently reads state only; its load/reset remains
behind the explicit reset or readiness gate. No certificate production edit needed.

### Public write/admission guards

Guard every non-reset persistence/publication entry before any validation mutation,
file capture/write, revision changes or scheduled update callback. Preserve existing
result shapes where available:

- prepareServerOption, both compose methods, prepareServerOptionCommit and commitPreparedServerOption return `{success:false,message:'server configuration is not ready'}`. Omit prepared/serverOption/revisionState on failure; do not merge from a non-ready current option.
- updateServerOption, updateTunnelingOption and removeTunnelingOption return false through those guarded paths. No nextTick update callback on rejection.
- save, publishPreparedServerOption, restoreCommittedState, markLastKnownGood and recordRollback change their void return to boolean: false on non-ready without side effects, true after the existing successful operation. Existing ready callers ignore the return and remain compatible; failures from native I/O keep existing exceptional semantics. Guard publish as well as prepare so a retained prepared object cannot activate a currently invalid store. Guard restore so an arbitrary snapshot is not an implicit reset.
- Move markLastKnownGood/recordRollback default revision selection into their body after the readiness guard; a default parameter must not access non-ready state first. Keep revisions/files unmodified on refusal.
- captureCommittedState and collection reads are ready-only invariant APIs. Normal invalid startup does not invoke them. Do not silently return an empty tunnel list or dummy committed tuple that could be mistaken for valid configuration. Pure verification methods remain usable on a supplied local candidate; the configuration mutation queue itself schedules work but conveys no readiness/authorization bypass.

Inspected ready callers: AdminServer prepares before atomic compound publication;
rollback captures/restores current committed state. TTTServer reads revision/options
only for runtime construction/apply. ServerApp calls updateServerOption for CLI
options and markLastKnownGood after successful listeners. Store.save is used by
constructor and explicit reset; no additional production direct-save caller was
found in the scoped search. Their return-value compatibility does not remove the
need for dedicated tests of every public non-ready admission/write entry.

### Reset/bootstrap ordering

Use private initialization/persistence logic to create or reset a valid local
candidate; do not temporarily publish a writable ready state merely to bypass guards.
Successful default bootstrap/reset publishes the option/revision/loadStatus together
after its writes succeed. Existing reset is the only explicit escape from invalid
state; preserve its intentional destructive semantics, but no implicit reset after
load failure. On reset failure keep non-ready status and surface the real I/O failure,
never continue certificate loading/listener startup. Preserve the original invalid
file/revision bytes in ordinary startup; explicit reset is the separately requested
exception, not the default recovery strategy.

- [x] Root freeze readiness and legacy getter invariant. Status: approved after independent exact API PASS; ready-only invariant error allowed, normal invalid flow uses results. Implementation assigned above with actual RED prerequisite.
- [ ] Non-ready API RED. Status: assert every public write/publication method fails before side effects, retained prepared/snapshot inputs cannot bypass, readServerOption returns failure, normal ServerApp failure never calls legacy getter, and valid/reset paths retain compatibility. Invariant misuse tests are separate from normal invalid-YAML result tests.

Root approval supersedes the proposal approval-pending clauses above. Normal invalid configuration never uses the legacy getter exception for control flow. Missing-default bootstrap and explicit successful reset publish readiness before ordinary getter use.

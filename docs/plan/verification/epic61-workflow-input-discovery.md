# Discovery #70

Status: independently reproduced and draft reviewed; root created [issue #70](https://github.com/ice3x2/TTTGate/issues/70), subsequently completed and closed. Completion evidence is recorded in `epic61-issue-70.md`.

## Observation and local reproduction

Both release workflows directly interpolate `inputs.version` into shell `run` text, including source archive commands and release-note generation. This predates #65. The new binary archive helper validates its argument, but source archive commands execute before that helper, so helper validation does not protect the earlier shell steps.

Independent local Git Bash reproduction used the actual release-note source lines from each workflow and substituted only this harmless input: `v$(printf TTTGATE_INPUT_EVALUATED)`.

- `build-release.yml`: `echo "## Release ${{ inputs.version }}" > release_notes.md` produced `## Release vTTTGATE_INPUT_EVALUATED`.
- `build-release-binaries.yml`: the equivalent TTTGate heading produced `## TTTGate vTTTGATE_INPUT_EVALUATED`.
- A control passing the same value through a quoted environment variable preserved the literal `$(printf ...)` text instead of evaluating it.

The experiment ran only the heading commands in newly owned temporary directories. It did not execute GitHub Actions, access network services, modify external files or prove that an unauthorized user can trigger these workflows. Workflow-dispatch permissions and any privilege-escalation impact are not asserted. The demonstrated defect is input being interpreted as shell syntax rather than data.

## Acceptance criteria

- Add a failing regression for unsafe version input before changing workflow handling, without executing harmful payloads.
- Treat dispatch text as data: pass values through environment/structured arguments, quote shell references, and validate the supported version format before any filename/archive or other consuming step.
- Audit both release workflows' shell references to the version; avoid protecting only the new helper while leaving earlier direct interpolation.
- Verify invalid values fail without command evaluation or artifact creation and valid version strings preserve expected filenames/release metadata.
- Preserve the intended workflow-dispatch authorization model; do not claim or introduce unrelated permission changes.
- Independently review, commit, push, close and notify.

Parent: #61. Existing issue discovered while reviewing #65; separate from archive path/layout defects. Implement under the serialized release owner. No hosted exploitation or CVE claim is made.

## Reproduction

Independent review of the actual compiled `timingSafeStringEqual` helper reproduced:

- `timingSafeStringEqual('aaf', 'aa') === true`
- `timingSafeStringEqual('', 'f') === true`
- `timingSafeStringEqual('a', 'b') === true`
- `timingSafeStringEqual('aaf', 'aa', 'hex', 1) === true`

The hex format check accepts an odd number of characters. `Buffer.from(value, 'hex')` drops an unmatched trailing nibble, causing distinct or malformed hex strings to compare as identical decoded buffers. This is a functional validation defect; no authentication bypass is claimed without separate call-site evidence.

## Acceptance criteria

- Add failing tests for odd-length hex inputs on either side, including empty/odd, distinct odd strings, Buffer/string mixtures and expectedLength.
- Reject malformed odd-length hex without exceptions used as normal control flow.
- Preserve legitimate even-length hex, empty/empty, Buffer and UTF-8 behavior, including odd-length UTF-8 text.
- Keep the existing same-length native timing-safe comparison/dummy path intact.
- Independently review and run focused plus integration regressions before commit, push, close and notification.

Parent: #61. Discovered while independently reviewing #64; keep a distinct issue and evidence rather than silently changing runtime behavior as part of a benchmark repair. Schedule in the runtime lane with exclusive helper/new-test ownership before final #63 integration checks.

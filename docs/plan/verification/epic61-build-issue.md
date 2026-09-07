## Problem

While implementing Epic #61 CI gate #14, a clean `npm ci --no-audit --no-fund` followed by `npm run build` at baseline `376b65c` fails with TS2315 in `node_modules/minipass/dist/commonjs/index.d.ts` lines 14, 17, 532 and 535: `Type 'EventEmitter' is not generic`.

Root reproduction on Windows reports installed `@types/node@18.16.19`. The new CI cannot establish a passing build baseline with this dependency type mismatch.

## Acceptance criteria

- Capture clean-install build failure before changing dependencies.
- Resolve the declared/locked Node type compatibility without disabling library type checking or changing runtime behavior.
- Clean install, TypeScript build and relevant tests pass.
- Independent review confirms the dependency change and scope.

Parent: #61. Discovered while resolving #14; handle in Wave 0 before subsequent issue implementation.

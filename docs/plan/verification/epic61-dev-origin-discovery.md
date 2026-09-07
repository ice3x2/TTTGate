## Reproduction

Independent investigation during #7 used a real isolated AdminServer and the actual `admin/vite.config.ts` proxy configuration, changing only the backend target port to an ephemeral loopback port. With the same valid session and CSRF token:

- A direct request using the AdminServer origin returned 200.
- A direct request carrying the Vite origin returned 403 `Forbidden origin`.
- A request through the actual Vite proxy returned 403 `Forbidden origin`.

Observed Vite port: 5173; isolated backend port: 64106. The configured `changeOrigin: true` and `/api` rewrite were retained. The backend correctly enforces its origin policy; the development proxy does not reconcile its browser origin with that policy.

This differs from #7's missing CSRF header. Serving test controllers from the actual AdminServer origin establishes the production-path fix but does not fix the supported development proxy workflow.

## Acceptance criteria

- Write a real-server failing regression with valid authentication and CSRF before changing proxy behavior.
- Make the intended development UI mutation flow work through the configured proxy.
- Preserve strict backend origin/CSRF checks and production TLS/security defaults; do not accept arbitrary origins or silently disable protection.
- Verify that foreign-origin requests remain rejected and that only the intended trusted development flow is adapted.
- Independently review, commit, push, close and notify with evidence.

Parent: #61. Schedule after #7 and before #8 in the same administrator lane, with exclusive development proxy/test ownership.

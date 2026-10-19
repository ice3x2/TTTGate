# Manual end-to-end checklist

Run this checklist once before every release. Record the date, the TTTGate version and the tester in the table at the end.

## Preparation

Steps:

1. Build the release with `node deploy.js`.
2. Start the server with `adminTls: true` and one HTTP tunnel configured.
3. Start one client pointed at the server.
4. Open the admin page in a browser.

Expected:

- The server, the client and the admin page all start without error.

Checklist:

- [ ] Build completed.
- [ ] Server started with `adminTls: true` and one HTTP tunnel.
- [ ] Client started and shows as connected in the admin page.
- [ ] Admin page opened successfully.

## Framework application (dev server with HMR)

Steps:

1. `npx create-next-app@latest e2e-app --ts --no-eslint --no-tailwind --app --src-dir --import-alias "@/*"`
2. `npm run dev` (serves on port 3000).
3. Configure a tunnel with `destinationPort: 3000, protocol: http`.
4. Open `http://<server-host>:<forwardPort>/` in Chrome.
5. Edit `src/app/page.tsx` and save.

Expected:

- The page renders.
- DevTools console has no red errors.
- Editing `src/app/page.tsx` refreshes the page within 5 seconds (HMR WebSocket through the tunnel).
- DevTools Network shows the `_next/webpack-hmr` WebSocket with status `101`.

Checklist:

- [ ] Page renders with no red console errors.
- [ ] Edit to `page.tsx` refreshes the page within 5 seconds.
- [ ] `_next/webpack-hmr` WebSocket shows status `101`.

## Public site (no login)

Steps:

1. Configure a tunnel with `destinationAddress: example.com, destinationPort: 80, protocol: http, httpOption: {rewriteHostInTextBody: true}`.
2. Open `http://<server-host>:<forwardPort>/` in Chrome.

Expected:

- The "Example Domain" page renders.
- The `More information...` link points at `https://www.iana.org/...` (external links are left untouched).

Checklist:

- [ ] "Example Domain" page renders.
- [ ] `More information...` link points at `https://www.iana.org/...`.

## TLS external port

Steps:

1. Reuse the tunnel from the previous section with `tls: true` added.
2. Open `https://<server-host>:<forwardPort>/` in Chrome.

Expected:

- The browser warns about the self-signed certificate.
- Proceeding past the warning shows the page.

Checklist:

- [ ] Browser warns about the self-signed certificate.
- [ ] Page shows after proceeding past the warning.

## Results

| Date | Version | Tester | Framework app | Public site | TLS | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| | | | | | | |

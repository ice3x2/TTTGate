# Source distribution archive mismatch

Status: static source inspection independently reviewed; root created GitHub #68 (OPEN). Actual archive generation/extraction has not been run for this finding.

`deploy.js` copies compiled contents from `build/src` into `dist.js` and copies `package-build.json` to `dist.js/package.json`. The resulting JavaScript entrypoint is `dist.js/app.js`; the administrator assets go to `dist.js/web`. In contrast, `dist` receives `web` and the configured binary output directory `bin`.

Both `.github/workflows/build-release.yml` and `.github/workflows/build-release-binaries.yml` create the source-distribution archive after `cd dist`. Their generated source instructions then run `node src/app.js ...`. Two mismatches follow directly from the code: the archive selects a directory other than the JavaScript distribution, and the documented entrypoint differs from the flat `app.js` layout produced in `dist.js`. The distribution manifest's server/client scripts already use `node app.js`.

This is separate from #65's binary filename/collection defect and #44's missing installation/type/test gates, though all three belong to one serialized release owner. Preserve Node 24 and the intended distribution contents. Defer implementation until a failing archive regression is recorded.

- [x] Independently review the issue draft and create the issue if accepted. Status: complete; root created https://github.com/ice3x2/TTTGate/issues/68 after review.
- [ ] Generate the actual JavaScript distribution and archive, then demonstrate missing required files/wrong documented command before changing packaging. Status: pending release lane.
- [ ] Require application JavaScript, runtime package manifest and web assets, and fail for missing/empty required files. Status: pending.
- [ ] Extract into a fresh directory, install required runtime dependencies and execute the documented command under Node 24 with bounded cleanup. Status: pending.
- [ ] Independent review and normal commit/push/closure/notification gates. Status: pending after issue creation.

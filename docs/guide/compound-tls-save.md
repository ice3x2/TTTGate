# Saving a tunnel option with its TLS certificate

POST or PUT `/api/tunnelingOption` accepts the normal option fields and the
configuration snapshot's `expectedRevision`. An editor can include `certInfo`
and `expectedCertificateRevision` from the corresponding external-certificate GET
response. For a renamed persisted row, include `previousForwardPort` identifying
that row. Send one request; do not delete the old row or upload its certificate
first.

Both revisions are checked while holding the shared configuration queue before
publication or listener changes. Missing/invalid required tokens return 400;
stale tokens and a rename onto another configured row return 409. The draft must
be retained on failure; reload/reconcile explicitly rather than replaying it with
new tokens. A certificate revision is required whenever the edit adds/replaces a
certificate or deletes the old certificate during rename, even without certInfo.
The certificate revision is global, so an unrelated certificate write can cause
a conservative conflict.

External-certificate DELETE now requires a JSON body containing
`expectedCertificateRevision`; older clients omitting it receive 400. GET
`/api/externalCert/:port` supplies `certInfo` and `revisionState.currentRevision`.
Standalone external certificate POST remains an authenticated explicit write;
administrator certificate APIs do not gain configuration revision fields.
Existing authentication, Origin and CSRF checks retain priority.

Compound success returns both `revisionState` and `certificateRevisionState`.
Private certificate data and compound metadata are separated from the normal
configuration YAML. Configuration-only edits do not advance certificate revision.
Existing pending changes to unrelated scopes remain pending.

The server stages the complete config/certificate file batch before publishing,
then applies runtime state. Caught publication/runtime failures restore the
captured committed and applied baseline; recovery failures return partial failure
with explicit failedScopes. This does not provide crash-atomic transactions across
multiple files or restore already-closed client connections.

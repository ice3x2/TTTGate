import {withConfigurationServer} from "./configuration-revision-fixture";
import {configurationFiles, peerFingerprint} from "./compound-review-fixture";
import {getFreePort} from "../../../helpers/network";
import {CertificationStore} from "../../../../src/server/CertificationStore";

test("malformed compound certificate shapes return 400 without mutation and release the queue", async () => withConfigurationServer(async f => {
    const port = await getFreePort();
    const option = {forwardPort: port, protocol: "tcp", tls: true, destinationAddress: "127.0.0.1", destinationPort: 9};
    expect((await f.request("POST", "/api/tunnelingOption", {...option, expectedRevision: f.store.revisionState.currentRevision})).statusCode).toBe(200);
    const certificates = CertificationStore.instance;
    const valid = certificates.getExternalCert(port);
    const malformed = [{}, {cert: valid.cert, ca: valid.ca}, {key: valid.key, ca: valid.ca},
        {key: valid.key, cert: valid.cert}, {...valid, key: null}, {...valid, cert: {}}, {...valid, ca: null}];
    const options = f.store.serverOption, revision = f.store.revisionState, certRevision = certificates.revisionState;
    const files = configurationFiles(f.root.rootDir), fingerprint = await peerFingerprint(port);
    const responses = [];
    for(const certInfo of malformed) responses.push(await f.request("POST", "/api/tunnelingOption", {...option, certInfo,
        expectedRevision: revision.currentRevision, expectedCertificateRevision: certRevision.currentRevision}));
    const unchanged = {options: f.store.serverOption, revision: f.store.revisionState, certRevision: certificates.revisionState,
        files: configurationFiles(f.root.rootDir), fingerprint: await peerFingerprint(port)};
    // Empty CA value remains valid; send the follow-up before asserting RED so
    // queue release is exercised even when the old shape handling returns 500.
    const followup = await f.request("POST", "/api/tunnelingOption", {...option, certInfo: {...valid, ca: {name: "", value: ""}},
        expectedRevision: revision.currentRevision, expectedCertificateRevision: certRevision.currentRevision}, 1);
    expect(responses.map(response => response.statusCode)).toEqual(malformed.map(() => 400));
    expect(unchanged).toEqual({options, revision, certRevision, files, fingerprint});
    expect(followup.statusCode).toBe(200);
}), 60_000);

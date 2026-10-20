import fs from "fs";
import path from "path";
import {withConfigurationServer} from "./configuration-revision-fixture";
import {getFreePort} from "../../../helpers/network";
import {CertificationStore} from "../../../../src/server/CertificationStore";

// 픽스처가 매번 TLS 인증서·서버·로그인을 준비해 테스트 하나가 4~5초 걸린다. 같은 픽스처를 쓰는 다른 파일처럼
// 기본 5초보다 넉넉히 둔다. 시간 초과가 나면 정리 전에 다음 테스트가 시작되고 남은 서버가 jest 종료를 막는다(#192).
jest.setTimeout(60_000);

test("stale same-row no-op rejects and valid config-only save does not advance certificate revision", async () => withConfigurationServer(async f => {
    const port = await getFreePort();
    const option = {forwardPort: port, protocol: "tcp", tls: false, destinationAddress: "127.0.0.1", destinationPort: 9};
    expect((await f.request("POST", "/api/tunnelingOption", {...option, expectedRevision: f.store.revisionState.currentRevision})).statusCode).toBe(200);
    const revision = f.store.revisionState.currentRevision, certificateRevision = CertificationStore.instance.revisionState.currentRevision;
    const exactRow = f.store.getTunnelingOption(port);
    expect((await f.request("POST", "/api/tunnelingOption", {...exactRow, previousForwardPort: port, expectedRevision: revision - 1})).statusCode).toBe(409);
    expect(f.store.revisionState.currentRevision).toBe(revision);
    expect((await f.request("POST", "/api/tunnelingOption", {...exactRow, previousForwardPort: port, expectedRevision: revision})).statusCode).toBe(200);
    expect(CertificationStore.instance.revisionState.currentRevision).toBe(certificateRevision);
    expect(fs.readFileSync(path.join(f.root.rootDir, "config/server.yaml"), "utf8")).not.toContain("previousForwardPort");
}));

test("invalid certificate preparation releases the queue for a following valid write", async () => withConfigurationServer(async f => {
    const port = await getFreePort(), revision = f.store.revisionState.currentRevision;
    const option = {forwardPort: port, protocol: "tcp", tls: false, destinationAddress: "127.0.0.1", destinationPort: 9};
    const certificate = CertificationStore.instance.getExternalCert(port); certificate.cert.value = "invalid PEM";
    const invalid = await f.request("POST", "/api/tunnelingOption", {...option, certInfo: certificate, expectedRevision: revision,
        expectedCertificateRevision: CertificationStore.instance.revisionState.currentRevision});
    expect(invalid.statusCode).toBe(400);
    expect((await f.request("POST", "/api/tunnelingOption", {...option, expectedRevision: revision}, 1)).statusCode).toBe(200);
}));

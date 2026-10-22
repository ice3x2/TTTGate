import * as tls from "tls";
import {X509Certificate} from "crypto";
import {CtrlCmd, CtrlPacket, CtrlPacketStreamer} from "../commons/CtrlPacket";
import {deriveEnrollmentKeys, openEnrollmentPayload, ENROLLMENT_PROTOCOL} from "../commons/Enrollment";
import {EnrollmentPayload} from "../commons/ProtocolV2";

/**
 * 등록 코드로 서버에서 신뢰 클라이언트 설정을 받는다(#214 REQ-1·REQ-3·REQ-7).
 *
 * 아직 CA 를 모르므로 TLS 인증서는 검증하지 않고 연결한다(TOFU). 대신 응답은 코드에서 유도한 키로
 * 봉인되어 있어, 코드를 모르는 서버(중간자)는 만들 수 없다. 응답 안의 CA 가 실제로 연결한 서버의
 * 인증서와 같은지도 확인한다.
 */
type EnrollmentFailureCategory = "rejected" | "proof" | "network" | "throttled" | "unavailable";
type EnrollmentResult = {ok: true, payload: EnrollmentPayload} | {ok: false, category: EnrollmentFailureCategory, message: string};

const DEFAULT_ENROLL_TIMEOUT_MS = 20_000;

const validPayload = (value: unknown): value is EnrollmentPayload => {
    const payload = value as EnrollmentPayload;
    return typeof payload === "object" && payload !== null
        && typeof payload.clientId === "string" && payload.clientId.length > 0
        && typeof payload.clientSecret === "string" && payload.clientSecret.length > 0
        && typeof payload.serverName === "string" && payload.serverName.length > 0
        && payload.tls === true
        && typeof payload.ca === "string" && payload.ca.includes("-----BEGIN CERTIFICATE-----");
};

const requestEnrollment = async (options: {host: string, port: number, code: string, timeoutMs?: number}): Promise<EnrollmentResult> => {
    const keys = await deriveEnrollmentKeys(options.code);
    return new Promise<EnrollmentResult>((resolve) => {
        let settled = false;
        const socket = tls.connect({host: options.host, port: options.port, rejectUnauthorized: false});
        const finish = (result: EnrollmentResult) => {
            if(settled) return;
            settled = true;
            clearTimeout(timer);
            socket.destroy();
            resolve(result);
        };
        const timer = setTimeout(() => finish({ok: false, category: "network",
            message: `no answer from ${options.host}:${options.port} within ${options.timeoutMs ?? DEFAULT_ENROLL_TIMEOUT_MS} ms`}),
            options.timeoutMs ?? DEFAULT_ENROLL_TIMEOUT_MS);
        const streamer = new CtrlPacketStreamer();
        socket.on("error", (error: NodeJS.ErrnoException) => finish({ok: false, category: "network",
            message: `cannot reach ${options.host}:${options.port} over TLS: ${error.code ?? error.message}. ` +
                "Enrollment needs TLS on the server control port."}));
        socket.on("close", () => finish({ok: false, category: "network", message: "the server closed the connection without an answer"}));
        socket.once("secureConnect", () => {
            socket.write(CtrlPacket.createEnrollRequest({protocol: ENROLLMENT_PROTOCOL, lookup: keys.lookup}).toBuffer());
        });
        socket.on("data", (chunk: Buffer) => {
            let packets: CtrlPacket[];
            try {
                packets = streamer.readCtrlPacketList(chunk);
            } catch {
                return finish({ok: false, category: "proof", message: "the server sent an invalid answer"});
            }
            const response = packets.find((packet) => packet.cmd === CtrlCmd.EnrollResponse);
            if(!response) return;
            const meta = response.enrollResponseMetaResult;
            if(meta.kind !== "valid") return finish({ok: false, category: "proof", message: "the server sent an invalid answer"});
            if(!meta.value.ok) {
                const reason = meta.value.reason;
                return finish(reason === "throttled"
                    ? {ok: false, category: "throttled", message: "too many failed attempts from this address. Wait 15 minutes and try again"}
                    : reason === "unavailable"
                        ? {ok: false, category: "unavailable", message: "the server does not accept enrollment (its control port must use TLS)"}
                        : {ok: false, category: "rejected", message: "the server rejected the code. It may be wrong, expired or already used; ask for a new code"});
            }
            const payload = openEnrollmentPayload(keys, meta.value);
            if(!validPayload(payload)) {
                return finish({ok: false, category: "proof",
                    message: "the answer is not sealed with this code. Another host may be in the middle (man-in-the-middle). Nothing was saved"});
            }
            const peer = socket.getPeerX509Certificate();
            let same = false;
            try {
                same = !!peer && peer.raw.equals(new X509Certificate(payload.ca).raw);
            } catch { /* 잘못된 PEM 은 불일치로 본다 */ }
            if(!same) {
                return finish({ok: false, category: "proof",
                    message: "the server certificate differs from the one in the sealed answer. Another host may be in the middle (man-in-the-middle). Nothing was saved"});
            }
            finish({ok: true, payload});
        });
    });
};

export {requestEnrollment, EnrollmentResult, EnrollmentFailureCategory};

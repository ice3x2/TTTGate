import tls from "node:tls";

/**
 * TLS 서버가 내놓는 인증서의 SHA-256 지문(콜론 구분 대문자)을 읽는다(#181).
 * 클라이언트가 없는 터널 포트는 핸드셰이크 직후 연결을 닫는데, 부하에서는 그 리셋이 핸드셰이크 처리보다 먼저 와
 * ECONNRESET 이 난다. 핸드셰이크가 끝나기 전의 리셋만 다시 시도하고, 기한은 부하를 감안해 넉넉히 둔다.
 */
export const peerFingerprint256 = async (port: number, options: {attempts?: number; timeoutMs?: number} = {}): Promise<string> => {
    const attempts = options.attempts ?? 5;
    const timeoutMs = options.timeoutMs ?? 20_000;
    for(let attempt = 1; ; attempt++) {
        try {
            return await probe(port, timeoutMs);
        } catch(error) {
            const code = (error as NodeJS.ErrnoException).code;
            if(attempt >= attempts || (code !== "ECONNRESET" && code !== "EPIPE")) throw error;
            // 재시도는 남긴다. 교체 직후처럼 리셋이 계속되면 시도가 다 떨어져 실패하므로 지속 결함은 가려지지 않는다.
            console.warn(`TLS identity probe retry ${attempt}/${attempts - 1} on port ${port}: ${code}`);
            await new Promise((resolve) => setTimeout(resolve, 100 * attempt));
        }
    }
};

const probe = (port: number, timeoutMs: number) => new Promise<string>((resolve, reject) => {
    const socket = tls.connect({host: "127.0.0.1", port, rejectUnauthorized: false});
    socket.setTimeout(timeoutMs, () => socket.destroy(new Error("TLS identity probe timed out")));
    socket.once("secureConnect", () => {
        const value = socket.getPeerCertificate().fingerprint256;
        socket.destroy();
        resolve(value);
    });
    socket.once("error", (error) => { socket.destroy(); reject(error); });
});

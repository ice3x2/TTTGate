/**
 * P6-T3 / REQ-15 — 클라이언트 옵션 범위 검증 공통화.
 *
 * Mock 금지: 실 yaml / 실 logger / 순수 함수 검증. YAML 로드 경로는 Environment + 실 fs.
 *
 * 시나리오:
 *   (1) port 음수(-1): 9126(기본값) 폴백 + warn.
 *   (2) port > 65535: 9126 폴백 + warn.
 *   (3) keepAlive 음수: 0 폴백 + warn.
 *   (4) globalMemCacheLimit 8(<16): 128 폴백 + warn. -1 sentinel은 통과.
 */
import {
    normalizationClientOption,
    DEFAULT_CLIENT_PORT,
    DEFAULT_CLIENT_KEEP_ALIVE,
    DEFAULT_CLIENT_MEM_LIMIT_MIB
} from "../../../src/types/TunnelingOption";

describe("REQ-15 normalizationClientOption range validation", () => {
    const captureWarn = () => {
        const messages: string[] = [];
        const warn = (msg: string) => { messages.push(msg); };
        return { messages, warn };
    };

    it("(1) port=-1 → 기본값 폴백 + warn", () => {
        const { messages, warn } = captureWarn();
        const out = normalizationClientOption({
            key: "k", host: "h", port: -1, tls: false, name: "n",
            globalMemCacheLimit: 128, keepAlive: 0
        }, warn);
        expect(out.port).toBe(DEFAULT_CLIENT_PORT);
        expect(messages.some((m) => m.includes("port"))).toBe(true);
    });

    it("(2) port>65535 → 기본값 폴백 + warn", () => {
        const { messages, warn } = captureWarn();
        const out = normalizationClientOption({
            key: "k", host: "h", port: 70000, tls: false, name: "n",
            globalMemCacheLimit: 128, keepAlive: 0
        }, warn);
        expect(out.port).toBe(DEFAULT_CLIENT_PORT);
        expect(messages.some((m) => m.includes("port"))).toBe(true);
    });

    it("(3) keepAlive<0 → 0 폴백 + warn", () => {
        const { messages, warn } = captureWarn();
        const out = normalizationClientOption({
            key: "k", host: "h", port: 1234, tls: false, name: "n",
            globalMemCacheLimit: 128, keepAlive: -5
        }, warn);
        expect(out.keepAlive).toBe(DEFAULT_CLIENT_KEEP_ALIVE);
        expect(messages.some((m) => m.toLowerCase().includes("keepalive"))).toBe(true);
    });

    it("(4) globalMemCacheLimit=8 (<16) → 128 폴백 + warn / -1 sentinel은 허용", () => {
        const { messages, warn } = captureWarn();
        const out1 = normalizationClientOption({
            key: "k", host: "h", port: 1234, tls: false, name: "n",
            globalMemCacheLimit: 8, keepAlive: 0
        }, warn);
        expect(out1.globalMemCacheLimit).toBe(DEFAULT_CLIENT_MEM_LIMIT_MIB);
        expect(messages.some((m) => m.includes("globalMemCacheLimit"))).toBe(true);

        const { messages: m2, warn: w2 } = captureWarn();
        const out2 = normalizationClientOption({
            key: "k", host: "h", port: 1234, tls: false, name: "n",
            globalMemCacheLimit: -1, keepAlive: 0
        }, w2);
        expect(out2.globalMemCacheLimit).toBe(-1);
        expect(m2.length).toBe(0);
    });

    it("정상 값은 warn 없이 통과", () => {
        const { messages, warn } = captureWarn();
        const out = normalizationClientOption({
            key: "k", host: "h", port: 9126, tls: false, name: "n",
            globalMemCacheLimit: 128, keepAlive: 0
        }, warn);
        expect(out.port).toBe(9126);
        expect(out.keepAlive).toBe(0);
        expect(out.globalMemCacheLimit).toBe(128);
        expect(messages.length).toBe(0);
    });
});

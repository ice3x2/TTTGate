import {defaultPasskeyName} from "../../admin/src/util/passkey";
import {translator} from "../../admin/src/i18n";

// 이슈 349 FR-8 — 등록 창의 이름 칸에 미리 넣는 기기 이름. 기기를 알 수 없을 때의 이름은 정한 언어다.
describe("defaultPasskeyName", () => {
    const withAgent = (agent: string, run: () => void) => {
        const before = Object.getOwnPropertyDescriptor(globalThis, "navigator");
        Object.defineProperty(globalThis, "navigator", {value: {userAgent: agent}, configurable: true});
        try { run(); } finally {
            if(before) Object.defineProperty(globalThis, "navigator", before);
            else delete (globalThis as {navigator?: unknown}).navigator;
        }
    };

    test("기기 종류는 언어와 상관없이 그 이름이다", () => {
        withAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64)", () => {
            expect(defaultPasskeyName(translator("ko"))).toBe("Windows");
        });
    });

    test("알 수 없는 기기는 정한 언어의 '패스키' 다", () => {
        withAgent("curl/8", () => {
            expect(defaultPasskeyName(translator("ko"))).toBe("패스키");
            expect(defaultPasskeyName(translator("en"))).toBe("Passkey");
        });
    });
});

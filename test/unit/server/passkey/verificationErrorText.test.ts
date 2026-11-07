import {verificationErrorText} from "../../../../src/server/admin/passkeyRoutes";

// #336 — 검증 실패 진단 로그. 라이브러리 메시지에는 인증 없는 요청의 값(origin·challenge)이 들어갈 수 있다.
describe("verificationErrorText", () => {
    it("이름과 메시지를 남기되 제어 문자는 ? 로 바꾼다", () => {
        const error = new Error('Unexpected origin "https://x"\n2026-11-08 [INFO] forged line\r\u0000');
        expect(verificationErrorText(error)).toBe('Error: Unexpected origin "https://x"?2026-11-08 [INFO] forged line??');
    });

    it("200자로 자른다", () => {
        expect(verificationErrorText(new Error("x".repeat(1000)))).toBe(`Error: ${"x".repeat(200)}`);
    });

    it("Error 가 아니면 이름 없이 문자열로 바꾼다", () => {
        expect(verificationErrorText("boom\n")).toBe("boom?");
    });
});

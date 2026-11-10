import {adminRequest} from "../../admin/src/controller/AdminRequest";
import {startI18n} from "../../admin/src/i18n";

// 이슈 349 FR-7a — AdminRequest 가 스스로 만드는 오류 문구도 리소스에서 온다. 영어 문구는 이슈 전과 같다.
// AdminRequest 는 브라우저 모듈이라 window·fetch 를 이 테스트 안에서만 대신 둔다. 언어는 앱과 같은 startI18n 으로 정한다.
describe("AdminRequest 의 오류 문구", () => {
    const globals = globalThis as {window?: unknown};

    beforeEach(() => { globals.window = {location: new URL("http://localhost:9300/")}; });
    afterEach(() => {
        delete globals.window;
        jest.restoreAllMocks();
        startI18n({languages: ["en-US"]}, {lang: ""});
    });

    const failures = async () => {
        const fetch = jest.spyOn(globalThis, "fetch");
        fetch.mockRejectedValueOnce(new Error("boom"));
        const network = await adminRequest("/api/x");
        fetch.mockResolvedValueOnce(new Response("not json", {status: 502}));
        const invalid = await adminRequest("/api/x");
        fetch.mockResolvedValueOnce(new Response(JSON.stringify({success: false}), {status: 500}));
        const http = await adminRequest("/api/x");
        const crossOrigin = await adminRequest("https://evil.example/api/x");
        return [network, invalid, http, crossOrigin].map((result) => result.message);
    };

    test("영어", async () => {
        expect(await failures()).toEqual([
            "Admin network request failed: boom",
            "Invalid JSON response from admin server (HTTP 502)",
            "Admin request failed (HTTP 500)",
            "Admin requests must use the same origin",
        ]);
    });

    test("한국어", async () => {
        startI18n({languages: ["ko-KR"]}, {lang: ""});
        expect(await failures()).toEqual([
            "관리 서버에 연결하지 못했습니다: boom",
            "관리 서버의 응답이 올바른 JSON 이 아닙니다(HTTP 502).",
            "관리 요청이 실패했습니다(HTTP 500).",
            "관리 요청은 같은 출처로만 보낼 수 있습니다.",
        ]);
    });
});

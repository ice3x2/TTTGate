import fs from "fs";
import path from "path";
import {detectLocale, i18n, plural, startI18n, t, translator} from "../../admin/src/i18n";
import {en, type Messages} from "../../admin/src/i18n/en";
import {ko} from "../../admin/src/i18n/ko";

// 이슈 349 — 관리 화면 문구 리소스(FR-1·2·4), 언어 판정(FR-3), <html lang>(FR-5).

describe("FR-3 detectLocale — 브라우저 언어 목록의 첫 값으로 정한다", () => {
    test.each([
        [["ko-KR"], undefined, "ko"],
        [["ko"], undefined, "ko"],
        [["KO-kr", "en-US"], undefined, "ko"],
        [["en-US", "ko-KR"], undefined, "en"],
        [["ja-JP"], undefined, "en"],
        [["fr"], undefined, "en"],
        [["kok-IN"], undefined, "en"],
        [[], "ko-KR", "ko"],
        [undefined, "ko", "ko"],
        [undefined, "en-GB", "en"],
        [undefined, undefined, "en"],
        [[""], undefined, "en"],
    ] as Array<[string[] | undefined, string | undefined, string]>)("languages=%j language=%s 이면 %s", (languages, language, expected) => {
        expect(detectLocale(languages, language)).toBe(expected);
    });
});

describe("FR-5 startI18n — 앱을 시작할 때 한 번 정하고 <html lang> 에 적는다", () => {
    afterEach(() => { startI18n({languages: ["en-US"]}, {lang: ""}); });

    test("한국어 브라우저면 lang 이 ko 이고 t() 가 한국어를 돌려준다", () => {
        const root = {lang: "en"};
        expect(startI18n({languages: ["ko-KR"], language: "ko-KR"}, root)).toBe("ko");
        expect(root.lang).toBe("ko");
        expect(i18n().locale).toBe("ko");
        expect(t("common.unableToConnect")).toBe(ko["common.unableToConnect"]);
    });

    test("plural 은 앱의 언어로 복수형을 고른다", () => {
        startI18n({languages: ["ko-KR"]}, {lang: ""});
        expect(plural("tunnel.connections", 2)).toBe("연결 2개");
        startI18n({languages: ["en-US"]}, {lang: ""});
        expect(plural("tunnel.connections", 1)).toBe("1 connection");
    });

    test("그 밖의 언어면 lang 이 en 이다", () => {
        const root = {lang: ""};
        expect(startI18n({languages: ["fr-FR"]}, root)).toBe("en");
        expect(root.lang).toBe("en");
        expect(t("common.unableToConnect")).toBe("Unable to connect to the server.");
    });

    test("main.ts 는 다른 모듈보다 먼저 언어를 정한다", () => {
        const main = fs.readFileSync(path.join(__dirname, "../../admin/src/main.ts"), "utf8");
        const imports = main.split("\n").filter((line) => line.startsWith("import "));
        expect(imports[0]).toMatch(/^import ['"]\.\/i18n\/start['"]/);
    });
});

describe("FR-4 t(key, params) — {name} 치환", () => {
    const english = translator("en");
    const korean = translator("ko");

    test("값을 이름으로 끼워 넣는다", () => {
        expect(english.t("serverError.passkey_limit", {limit: 20})).toBe("You can register up to 20 passkeys.");
        expect(korean.t("serverError.passkey_limit", {limit: 20})).toBe("패스키는 20개까지 등록할 수 있습니다.");
    });

    test("받지 못한 이름은 그대로 둔다", () => {
        expect(english.t("serverError.passkey_limit")).toBe("You can register up to {limit} passkeys.");
    });

    test("복수형은 개수를 받는 별도 키로 고른다", () => {
        expect(english.plural("tunnel.connections", 1)).toBe("1 connection");
        expect(english.plural("tunnel.connections", 2)).toBe("2 connections");
        expect(english.plural("tunnel.connections", 0)).toBe("0 connections");
        expect(korean.plural("tunnel.connections", 1)).toBe("연결 1개");
        expect(korean.plural("tunnel.connections", 3)).toBe("연결 3개");
    });

    test("has 는 리소스에 있는 키만 참이다", () => {
        expect(english.has("serverError.port_not_allowed")).toBe(true);
        expect(english.has("serverError.unknown_code")).toBe(false);
        expect(english.has("toString")).toBe(false);
    });

    test("Intl 에 넘길 언어 태그", () => {
        expect(english.intl).toBe("en-US");
        expect(korean.intl).toBe("ko-KR");
    });
});

describe("FR-2 ko.ts 와 en.ts 의 키", () => {
    test("두 파일의 키가 같다", () => {
        expect(Object.keys(ko).sort()).toEqual(Object.keys(en).sort());
    });

    test.each([["en", en], ["ko", ko]] as Array<[string, Record<string, string>]>)("%s 에 빈 값이 없다", (_name, messages) => {
        expect(Object.entries(messages).filter(([, value]) => value.trim() === "").map(([key]) => key)).toEqual([]);
    });

    test.each([["en", en], ["ko", ko]] as Array<[string, Record<string, string>]>)("%s 의 치환 이름이 상대 파일과 같다", (_name, messages) => {
        const names = (value: string) => (value.match(/\{\w+\}/g) ?? []).sort();
        const other: Record<string, string> = messages === en ? ko : en;
        expect(Object.keys(messages).filter((key) => names(messages[key]).join() !== names(other[key]).join())).toEqual([]);
    });

    // 검토 M-3: 영어 문구를 그대로 복사한 한국어 값을 잡는다. 자리표시자를 빼면 영어 낱말이 없는 형식 문구("{name} ({code})")만 두 언어에서 같아도 된다.
    test("ko 값은 형식 문구가 아니면 en 값과 다르다", () => {
        const english: Record<string, string> = en;
        const korean: Record<string, string> = ko;
        const formatOnly = (value: string) => !/[A-Za-z]/.test(value.replace(/\{\w+\}/g, ""));
        expect(Object.keys(en).filter((key) => english[key] === korean[key] && !formatOnly(korean[key])).map((key) => `${key}: ${korean[key]}`)).toEqual([]);
    });

    // 검토 M-4·LOW: 한국어 문구의 표기 규칙.
    test("영어 낱말 뒤의 조사는 띄우지 않는다", () => {
        const korean: Record<string, string> = ko;
        const spaced = /[A-Za-z][A-Za-z0-9]* (로|으로|를|을|이|가|는|은|와|과|의|에|에서|도|만|이나|나)(?=[\s.,)]|$)/;
        expect(Object.keys(korean).filter((key) => spaced.test(korean[key])).map((key) => `${key}: ${korean[key]}`)).toEqual([]);
        expect(ko["cert.incorrectNote"]).toBe("올바르지 않은 인증서를 올리면 HTTP로 동작합니다.");
    });

    test("문장은 말줄임표가 아니라 마침표로 끝낸다", () => {
        const korean: Record<string, string> = ko;
        expect(Object.keys(korean).filter((key) => /습니다…$/.test(korean[key]))).toEqual([]);
        expect(ko["app.offline"]).toBe("서버에 연결할 수 없습니다.");
    });

    test("보기만 허용하는 상태는 '보기 전용' 한 용어로 쓴다", () => {
        const korean: Record<string, string> = ko;
        expect(Object.keys(korean).filter((key) => /보기만/.test(korean[key]))).toEqual([]);
        expect([ko["tunnel.viewOnly"], ko["tunnels.viewOnly"], ko["group.crudReadOnly"]]).toEqual(["보기 전용", "보기 전용", "보기 전용"]);
        expect(fs.readFileSync(path.resolve(__dirname, "../../admin/src/i18n/ko.ts"), "utf8")).toMatch(/\/\/\s+view only \/ read only\s+보기 전용/);
    });

    test("켜짐 상태는 Online 대신 한국어로 말한다", () => {
        expect(ko["tunnelEdit.startupHint"]).toBe("서버가 시작할 때, 터널을 만들 때, 포트를 열지 못한 터널을 저장할 때 씁니다. 그 밖에는 저장해도 켜짐·꺼짐 상태와 남은 시간이 그대로입니다. 켜진 터널은 저장하면 지금 연결이 끊길 수 있습니다.");
    });

    test("시스템 정보의 내부 인터페이스 여부는 영어 화면에서 지금처럼 true·false, 한국어 화면에서 예·아니요다", () => {
        expect([en["sysinfo.internalYes"], en["sysinfo.internalNo"]]).toEqual(["true", "false"]);
        expect([ko["sysinfo.internalYes"], ko["sysinfo.internalNo"]]).toEqual(["예", "아니요"]);
    });

    test("보안 화면의 추가 시각 열 머리글", () => {
        expect(ko["security.added"]).toBe("추가한 시각");
    });

    test("한국어 문구는 자연스러운 표현을 쓴다", () => {
        expect(ko["serverError.trusted_client_not_allowed"]).toBe("선택한 신뢰 클라이언트 가운데 그룹에 허용되지 않은 것이 있습니다.");
        expect(ko["serverError.passkey_busy"]).toBe("서버에 요청이 많습니다. 1분 뒤에 다시 시도하세요.");
        expect(ko["request.csrfNotRestored"]).toBe("CSRF 토큰 쿠키를 다시 받지 못했습니다.");
    });

    // jest 는 isolatedModules 로 형을 검사하지 않으므로 아래 @ts-expect-error 는 jest 실행에서 확인되지 않는다.
    // 이 검사는 `npm run typecheck`(tsconfig.test.json)가 강제하고, CI 의 typecheck 작업(code-regression.yml)이 이를 돌린다.
    test("키가 빠지거나 남으면 형 검사에서 실패한다(AC-3)", () => {
        const {["common.unableToConnect"]: _dropped, ...missing} = en;
        // @ts-expect-error 키가 하나 빠진 객체는 Messages 가 아니다.
        const withoutKey: Messages = missing;
        // @ts-expect-error 리소스에 없는 키를 더할 수 없다.
        const withExtra: Messages = {...en, "extra.key": "x"};
        expect([withoutKey, withExtra]).toHaveLength(2);
    });
});

describe("이슈 349 FR-7 Translator.list — 값 목록을 그 언어의 목록 표기로 잇는다", () => {
    test("영어는 and 로, 한국어는 및 으로 잇는다", () => {
        expect(translator("en").list(["TCP", "HTTP", "HTTPS"])).toBe("TCP, HTTP, and HTTPS");
        expect(translator("ko").list(["TCP", "HTTP", "HTTPS"])).toBe("TCP, HTTP 및 HTTPS");
    });

    test("숫자도 잇고, 하나뿐이면 그 값이고, 비면 빈 문자열이다", () => {
        expect(translator("en").list([8080, 8443])).toBe("8080 and 8443");
        expect(translator("ko").list([8080])).toBe("8080");
        expect(translator("en").list([])).toBe("");
    });
});

// 이슈 365 — 포트 범위 버튼과 허용 범위 칩의 문구.
describe("이슈 365 문구", () => {
    test("허용 범위 칩의 묶음 이름·안내·잠금 이유", () => {
        expect([ko["tunnel.rangeChipsLabel"], en["tunnel.rangeChipsLabel"]]).toEqual(["허용 범위에서 포트 고르기", "Choose a port from an allowed range"]);
        expect([ko["tunnel.rangeChipsNote"], en["tunnel.rangeChipsNote"]])
            .toEqual(["범위를 누르면 목록에 있는 터널이 쓰지 않는 첫 포트를 넣습니다.", "Choose a range to fill in the first port no tunnel in your list uses."]);
        expect(translator("ko").t("tunnel.useFreePort", {range: "20000–20100"})).toBe("20000–20100 범위의 빈 포트 넣기");
        expect(ko["tunnel.rangeFull"]).toBe("이 범위의 포트를 모두 쓰고 있습니다.");
    });

    test("범위 줄과 헤더 줄의 버튼 이름", () => {
        expect([ko["group.rangeStart"], ko["group.rangeEnd"], ko["group.addRange"]]).toEqual(["시작 포트", "끝 포트", "범위 추가"]);
        expect(translator("ko").t("group.deleteRange", {from: 20000, to: 20100})).toBe("20000–20100 범위 삭제");
        expect([ko["group.deleteRangeTitle"], en["group.deleteRangeTitle"]]).toEqual(["범위 삭제", "Delete range"]);
        expect([ko["header.add"], ko["header.remove"], en["header.remove"]]).toEqual(["헤더 추가", "헤더 삭제", "Remove header"]);
    });
});


describe("이슈 369 연결 버튼의 보조 기술용 이름", () => {
    test("연결 수에 따라 단수·복수를 고른다", () => {
        const english = translator("en");
        const korean = translator("ko");
        expect(english.plural("tunnel.connectionsOpen", 1, {title: "ssh-office"})).toBe("Show the 1 connection to ssh-office");
        expect(english.plural("tunnel.connectionsOpen", 2, {title: "ssh-office"})).toBe("Show the 2 connections to ssh-office");
        expect(korean.plural("tunnel.connectionsOpen", 1, {title: "ssh-office"})).toBe("ssh-office의 연결 1개 보기");
    });
});

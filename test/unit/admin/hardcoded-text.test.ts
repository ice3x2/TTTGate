import fs from "fs";
import path from "path";
import {adminTextSources, findHardcodedText, type Finding} from "../../helpers/hardcodedText";

// 이슈 349 FR-8·AC-5·AC-7 — 관리 화면 소스에 영어 문구가 하드코딩으로 남지 않았는지 검사한다.
// 이 파일은 test/unit 에 있어 CI 의 fast 작업(npm run test:unit)이 매번 돌린다.

const root = path.resolve(__dirname, "../../..");
const svelte = (source: string) => findHardcodedText("Sample.svelte", source);
const tsModule = (source: string) => findHardcodedText("sample.ts", source);
const texts = (findings: Finding[]) => findings.map((finding) => finding.text);

describe("AC-7 검사가 잡아야 하는 문구", () => {
    test("<script> 의 영어 문장 리터럴(message = 'Try again later.')", () => {
        expect(texts(svelte("<script lang=\"ts\">\n    let message = $state('');\n    message = 'Try again later.';\n</script>\n<p>{message}</p>\n"))).toEqual(["Try again later."]);
    });

    test("부품 속성의 영어 문구(label=\"Account\")", () => {
        expect(texts(svelte("<Field label=\"Account\" for=\"x\"><TextInput id=\"x\" /></Field>\n"))).toEqual(["Account"]);
    });

    test("템플릿 글자", () => {
        const found = svelte("<div class=\"card\">\n    <h2>Sign in</h2>\n    <Button>Save</Button>\n</div>\n");
        expect(texts(found)).toEqual(["Sign in", "Save"]);
        expect(found.map((finding) => finding.line)).toEqual([2, 3]);
    });

    test("사용자에게 보이는 HTML 속성", () => {
        expect(texts(svelte("<button aria-label=\"Close\" title=\"Close the dialog\">×</button>\n<input placeholder=\"Search\">\n<img alt=\"Logo\" src=\"a.png\">\n")))
            .toEqual(["Close", "Close the dialog", "Search", "Logo"]);
    });

    test("글자를 그리는 속성의 식 안 리터럴", () => {
        expect(texts(svelte("<Button title={busy ? 'Saving' : 'Save'} ariaLabel={`Remove ${name}`} />\n"))).toEqual(["Saving", "Save", "Remove ${…}"]);
    });

    test("템플릿 글자 자리의 식 안 리터럴", () => {
        expect(texts(svelte("<p>{busy ? 'Saving…' : 'Save'}</p>\n"))).toEqual(["Saving…", "Save"]);
    });

    test("속성 식 안의 영어 문장(알림)", () => {
        expect(texts(svelte("<Button onclick={() => toast.push({tone: 'pulse', message: 'Saved'})}>{t('common.save')}</Button>\n"))).toEqual(["Saved"]);
    });

    test("글자 속성 이름의 객체 값과 문장 모양의 리터럴(.ts 모듈)", () => {
        expect(texts(tsModule("export const OPTIONS = [{value: 'regular', label: 'Regular'}];\nexport const fail = () => ({success: false, message: 'Failed to load audit events.'});\n")))
            .toEqual(["Regular", "Failed to load audit events."]);
    });

    test("대문자로 시작해 마침표로 끝나는 한 단어도 문장이다", () => {
        expect(texts(tsModule("error = 'Required.';\n"))).toEqual(["Required."]);
    });
});

describe("검사가 허용하는 것", () => {
    test("제품 이름·단위·코드 값·CSS 값·경로·주석", () => {
        const source = [
            "<script lang=\"ts\">",
            "    // Try again later. 주석은 보지 않는다.",
            "    /* Sign in to continue. */",
            "    const style = 'border: 1px solid var(--line-1)';",
            "    const path = '/api/admin/tunnels';",
            "    const kind = item.tone === 'alarm' ? 'warn' : 'pulse';",
            "    const svg = '<svg width=\"20\" height=\"20\" viewBox=\"0 0 20 20\" fill=\"none\"></svg>';",
            "    const options = [{value: 'tcp', label: 'TCP'}, {value: 'https', label: 'HTTPS'}];",
            "    const focusable = 'button, [href], input, select, textarea, [tabindex]:not([tabindex=\"-1\"])';",
            "    const pem = ['-----BEGIN PRIVATE KEY-----', '-----END RSA PRIVATE KEY-----'];",
            "    const rotate = `rotate: ${deg}deg`;",
            "    const command = `TTTGate client join ${host}:${port} --code ${code}`;",
            "    if(!hash) throw new Error('hash not found');",
            "    class Gone extends Error { constructor() { super('Invalid session'); } }",
            "</script>",
            "<!-- Save the tunnel -->",
            "<h1 class=\"hdr title\">TTTGate</h1>",
            "<span class=\"u\">KiB</span> <span>{rx} MiB</span> <span>%</span>",
            "<p>{t('tunnels.title')}</p>",
            "{#if tone === 'alarm'}<Badge tone=\"alarm\">{t('common.failed')}</Badge>{/if}",
            "<Select id=\"protocol\" options={options} label={t('tunnel.protocol')} />",
            "<TextInput id=\"login-username\" autocomplete={webauthn ? 'username webauthn' : 'username'} placeholder=\"gw.example.com\" />",
            "<style>",
            "    .hdr title { font-family: var(--ff-display); }",
            "</style>",
        ].join("\n");
        expect(svelte(source)).toEqual([]);
    });
});

describe("FR-8 관리 화면 소스에 영어 문구가 하드코딩으로 남지 않는다", () => {
    const files = adminTextSources(root);

    test("검사 대상에 화면과 문구를 만드는 .ts 모듈이 들어 있고, 문구 리소스는 빠진다", () => {
        const relative = files.map((file) => path.relative(root, file).split(path.sep).join("/"));
        for(const expected of ["admin/src/App.svelte", "admin/src/screens/TunnelsScreen.svelte", "admin/src/shell/nav.ts", "admin/src/screens/parts/tunnelRow.ts",
            "admin/src/screens/parts/tunnelPolicy.ts", "admin/src/util/passkey.ts", "admin/src/util/relativeTime.ts", "admin/src/controller/AdminRequest.ts"]) {
            expect(relative).toContain(expected);
        }
        expect(relative).not.toContain("admin/src/i18n/en.ts");
        expect(relative).not.toContain("admin/src/i18n/ko.ts");
    });

    test("하드코딩 문구가 없다", () => {
        const found = files.flatMap((file) => findHardcodedText(path.relative(root, file).split(path.sep).join("/"), fs.readFileSync(file, "utf8")));
        expect(found.map((finding) => `${finding.file}:${finding.line} [${finding.rule}] ${finding.text}`)).toEqual([]);
    });
});

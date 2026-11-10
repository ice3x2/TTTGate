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

describe("목록에 없는 속성의 따옴표 값도 글자로 본다", () => {
    test.each([
        ["값을 그리는 부품 속성", "<Kpi value=\"No data yet\" />\n", ["No data yet"]],
        ["대문자로 시작하는 한 단어", "<Kpi value=\"Idle\" />\n", ["Idle"]],
        ["제출 버튼의 value", "<input type=\"submit\" value=\"Save changes\">\n", ["Save changes"]],
        ["보조 기술용 aria 속성", "<div aria-roledescription=\"slider\" aria-valuetext=\"Half full\"></div>\n", ["slider", "Half full"]],
        ["aria-placeholder", "<div aria-placeholder=\"Type a name\"></div>\n", ["Type a name"]],
        ["이름이 처음 보는 부품 속성", "<Header back=\"Back to list\" />\n", ["Back to list"]],
    ])("%s", (_name, source, expected) => {
        expect(texts(svelte(source))).toEqual(expected);
    });

    test("토큰 속성·data-*·지시어·SVG 값은 글자가 아니다", () => {
        const source = [
            "<a href=\"https://example.com/docs\" target=\"_blank\" rel=\"noopener noreferrer\" data-testid=\"Save button\">{t('common.save')}</a>",
            "<Button variant=\"ghost\" size=\"sm\" tone=\"alarm\" onclick={save}>{t('common.save')}</Button>",
            "<svg viewBox=\"0 0 20 20\" fill=\"none\" stroke=\"currentColor\" aria-hidden=\"true\"><path d=\"M4 10h12 M10 4v12\" stroke-linecap=\"round\" /></svg>",
            "<div style=\"width: 10px\" aria-live=\"polite\" bind:this={box} class:open={open} transition:fade></div>",
        ].join("\n");
        expect(svelte(source)).toEqual([]);
    });
});

describe("글자 자리에서는 소문자 한 단어도 영어 문구다", () => {
    test.each([
        ["템플릿 글자 자리의 식", "<p>{busy ? 'saving' : 'idle'}</p>\n", ["saving", "idle"]],
        ["템플릿 글자 자리의 리터럴 하나", "<p>{'none'}</p>\n", ["none"]],
        ["보이는 HTML 속성", "<button aria-label=\"close\">×</button>\n", ["close"]],
        ["부품 글자 속성", "<Field label=\"optional\" />\n", ["optional"]],
        ["글자 속성의 식", "<Button title={open ? 'close' : 'open'} />\n", ["close", "open"]],
    ])("%s", (_name, source, expected) => {
        expect(texts(svelte(source))).toEqual(expected);
    });

    test("글자 속성 이름의 객체 값(.ts 모듈)", () => {
        expect(texts(tsModule("export const OPTIONS = [{value: 'regular', label: 'regular'}];\n"))).toEqual(["regular"]);
    });

    test("문구 키·함수 인자·비교 피연산자는 코드 값이다", () => {
        const source = [
            "<p>{t('tunnels.title')}</p>",
            "<p>{i18n().dateTime({month: 'short', day: '2-digit'}).format(at)}</p>",
            "<p>{kind === 'alarm' ? t('common.failed') : t('common.done')}</p>",
            "<Field label={t('tunnel.protocol', {kind: 'tcp'})} />",
        ].join("\n");
        expect(svelte(source)).toEqual([]);
    });
});

describe("코드 값 모양 예외가 영어 문구를 놓치지 않는다", () => {
    test.each([
        ["마침표로 끝나는 오류 속성", "<Field error=\"Required.\" />\n", ["Required."]],
        ["쌍점으로 끝나는 라벨", "<Field label=\"Port:\" />\n", ["Port:"]],
        ["빗금으로 이은 낱말", "<Field label=\"On/Off\" />\n", ["On/Off"]],
        ["글자 속성 식의 쌍점 라벨", "<Field label={'Name:'} />\n", ["Name:"]],
        ["글자 자리 식의 빗금 낱말", "<p>{x ? 'Online' : 'Offline/Idle'}</p>\n", ["Online", "Offline/Idle"]],
        ["on 으로 시작하는 일반 속성", "<Comp online=\"Not connected\" />\n", ["Not connected"]],
        ["아무 함수로 감싼 글자", "<p>{String(busy ? 'saving' : 'idle')}</p>\n<p>{format('none')}</p>\n", ["saving", "idle", "none"]],
    ])("%s", (_name, source, expected) => {
        expect(texts(svelte(source))).toEqual(expected);
    });

    test("객체 글자 키의 쌍점 라벨(.ts 모듈)", () => {
        expect(texts(tsModule("const o = {label: 'Port:'};\n"))).toEqual(["Port:"]);
    });

    test("토큰 속성이라도 식 안의 영어 문장은 잡는다", () => {
        expect(texts(svelte("<Comp kind={x ? 'Something went wrong' : 'a'} />\n"))).toEqual(["Something went wrong"]);
    });
});

describe("DOM 글자 속성", () => {
    test("textContent·innerText 에 넣는 영어 문구", () => {
        expect(texts(tsModule("el.textContent = 'hello';\nnode.innerText = 'Loading';\n"))).toEqual(["hello", "Loading"]);
    });
});

describe("잡은 예외의 원문을 화면에 보이지 않는다", () => {
    const script = (body: string) => svelte(`<script lang="ts">\n${body}\n</script>\n`);
    const rawErrors = (findings: Finding[]) => findings.filter((finding) => finding.rule === "raw-error").map((finding) => finding.text);

    test.each([
        ["문자열로 이은 예외", "try { await load(); } catch(e) { alert(e + ''); }", ["e + ''"]],
        ["예외의 message", "try { await load(); } catch(e) { if(e instanceof Error) alert(e.message); }", ["e.message"]],
        ["String(예외)", "try { await load(); } catch(error) { message = String(error); }", ["String(error)"]],
        ["템플릿 리터럴에 넣은 예외", "try { await load(); } catch(err) { toast.push({tone: 'alarm', message: `${err}`}); }", ["${err}"]],
        ["Promise.catch 의 인자", "load().catch((e) => { status = e.message; });", ["e.message"]],
        ["Promise.catch 의 괄호 없는 인자", "load().catch(e => toast.push({message: e.toString()}));", ["e.toString()"]],
        ["형을 붙인 catch 인자", "try { await load(); } catch(e: unknown) { alert(String(e)); }", ["String(e)"]],
        ["옵셔널 체이닝", "try { await load(); } catch(e: any) { alert(e?.message); }", ["e?.message"]],
        ["형 단언", "try { await load(); } catch(e) { alert((e as Error).message); }", ["(e as Error).message"]],
        ["function 식의 catch 인자", "p.catch(function(e) { alert(e.message); });", ["e.message"]],
        ["async 화살표의 catch 인자", "p.catch(async (e) => alert(e.message));", ["e.message"]],
        ["then 의 실패 처리 인자", "p.then(ok, (e) => alert(e.message));", ["e.message"]],
    ])("%s", (_name, body, expected) => {
        expect(rawErrors(script(body))).toEqual(expected);
    });

    test("로그·종류 판별·번역 문구의 값은 화면 원문이 아니다", () => {
        const body = [
            "try { await load(); } catch(e) {",
            "    console.error(e.message, String(e));",
            "    if(e instanceof InvalidSession) sessionOut();",
            "    else alert(t('common.unableToConnect'));",
            "}",
            "try { await send(); } catch(error) { return failure(t('request.networkFailed', {reason: error instanceof Error ? error.message : String(error)})); }",
            "const shown = result.message;",
            "try { await load(); } catch(e) { throw new Error(e.message); }",
        ].join("\n");
        expect(script(body)).toEqual([]);
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
            "    const owners = [{value: 'system:migrated', label: 'system:migrated'}];",
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
            "<TextInput id=\"client-new-id\" placeholder=\"edge-1\" />",
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

import fs from "fs";
import path from "path";

// 이슈 349 FR-10·AC-6 — 관리 화면을 여는 테스트 브라우저는 언어를 en-US 로 고정한다. 시스템 언어가 한국어인 PC 에서도
// 영어 화면 테스트가 영어 문구를 본다. browser.newPage() 는 시스템 언어를 따르므로 locale 을 준 문맥에서 페이지를 연다.
const root = path.resolve(__dirname, "../..");
const BROWSER_FILES = ["test/helpers/adminBrowser.ts", "test/admin/passkey-e2e.test.ts"];

test.each(BROWSER_FILES)("%s 는 locale 을 준 문맥으로만 페이지를 연다", (file) => {
    const source = fs.readFileSync(path.join(root, file), "utf8");
    expect(source).not.toMatch(/browser\??\.newPage\(/);
    const contexts = source.match(/newContext\(\{[^)]*\}\)/g) ?? [];
    expect(contexts.length).toBeGreaterThan(0);
    expect(contexts.filter((call) => !/locale:/.test(call))).toEqual([]);
});

test("관리 화면을 여는 다른 테스트는 공용 브라우저 helper(adminBrowser.ts) 를 거친다", () => {
    const dir = path.join(root, "test/admin");
    const direct = fs.readdirSync(dir).filter((name) => name.endsWith(".ts"))
        .filter((name) => /chromium\.launch\(/.test(fs.readFileSync(path.join(dir, name), "utf8")))
        .map((name) => `test/admin/${name}`);
    expect(direct.filter((file) => !BROWSER_FILES.includes(file))).toEqual([]);
});

test("공용 브라우저 helper 는 기본이 en-US 이고 한국어 화면 테스트용 ko-KR 을 받는다", () => {
    const source = fs.readFileSync(path.join(root, "test/helpers/adminBrowser.ts"), "utf8");
    expect(source).toMatch(/locale\?: "en-US" \| "ko-KR"/);
    expect(source).toMatch(/locale: options\.locale \?\? "en-US"/);
});

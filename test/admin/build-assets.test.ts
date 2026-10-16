import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {spawnSync, SpawnSyncReturns} from "child_process";

// U1-10 / #92 — 배포 빌드 산출물에 번들 서체 7개가 들어 있고 외부 서체·부트스트랩 흔적이 없다(결정 D2·D6).
jest.setTimeout(60_000);

const root = path.resolve(__dirname, "../..");
// entrypoint.test.ts 가 admin/dist 를 빌드·서빙하므로, 이 테스트는 자기 임시 디렉터리에 빌드한다.
// 병렬로 돌아도 서로의 산출물을 지우지 않고, 빌드가 실패하면 이전 산출물이 남지 않는다.
const distDir = fs.mkdtempSync(path.join(os.tmpdir(), "admin-build-assets-"));
const assetsDir = path.join(distDir, "assets");

const FONT_STEMS = [
    "noto-serif-latin-400", "noto-serif-latin-600",
    "noto-sans-latin-400", "noto-sans-latin-500", "noto-sans-latin-700",
    "jetbrains-mono-latin-400", "jetbrains-mono-latin-500",
];

const collectFiles = (dir: string): string[] => {
    let files: string[] = [];
    for(const entry of fs.readdirSync(dir, {withFileTypes: true})) {
        const full = path.join(dir, entry.name);
        if(entry.isDirectory()) { files = files.concat(collectFiles(full)); continue; }
        files.push(full);
    }
    return files;
};

describe("admin production build assets", () => {
    let build: SpawnSyncReturns<string>;

    beforeAll(() => {
        build = spawnSync(process.execPath, [path.join(root, "admin/node_modules/vite/bin/vite.js"), "build", "--outDir", distDir, "--emptyOutDir"], {
            cwd: path.join(root, "admin"), encoding: "utf8", timeout: 50_000,
            env: {...process.env, NODE_ENV: "production"},
        });
    });

    afterAll(() => {
        fs.rmSync(distDir, {recursive: true, force: true});
    });

    test("프로덕션 빌드가 exit 0 이고 svelte 플러그인 경고가 없다", () => {
        expect(build.error).toBeUndefined();
        expect({status: build.status, stderr: build.status ? build.stderr : ""}).toEqual({status: 0, stderr: ""});
        expect(build.stderr).not.toContain("[vite-plugin-svelte]");
    });

    test("index.html 이 /assets/*.css 를 stylesheet 로 참조한다", () => {
        const html = fs.readFileSync(path.join(distDir, "index.html"), "utf8");
        expect(html).toMatch(/<link rel="stylesheet"[^>]*href="\/assets\/[^"]+\.css"/);
    });

    test.each(FONT_STEMS)("assets 에 %s*.woff2 가 정확히 1개 있다", (stem) => {
        const matches = fs.readdirSync(assetsDir).filter((name) => name.startsWith(stem) && name.endsWith(".woff2"));
        expect(matches).toHaveLength(1);
    });

    test("빌드된 CSS 의 woff2 참조가 정확히 7건이고 7개 서체를 모두 가리킨다", () => {
        const css = fs.readdirSync(assetsDir).filter((name) => name.endsWith(".css"))
            .map((name) => fs.readFileSync(path.join(assetsDir, name), "utf8")).join("\n");
        const refs = css.match(/url\([^)]*\.woff2\)/g) ?? [];
        expect(refs).toHaveLength(7);
        for(const stem of FONT_STEMS) {
            expect(refs.filter((ref) => ref.includes(stem))).toHaveLength(1);
        }
    });

    // JS 에는 부트스트랩 토큰 로그인(bootstrapToken·"Bootstrap token")이 정상 기능으로 들어 있다.
    // 그래서 CSS 는 'bootstrap' 문자열 자체를, HTML·JS 는 Bootstrap CSS 의 배너·배포 주소·파일명을 금지한다(결정 D2).
    const FORBIDDEN: Record<string, RegExp[]> = {
        ".css": [/fonts\.googleapis\.com/, /fonts\.gstatic\.com/, /bootstrap/i],
        ".html": [/fonts\.googleapis\.com/, /fonts\.gstatic\.com/, /Bootstrap\s+v\d/i, /getbootstrap/i, /bootstrap\.min/i],
        ".js": [/fonts\.googleapis\.com/, /fonts\.gstatic\.com/, /Bootstrap\s+v\d/i, /getbootstrap/i, /bootstrap\.min/i],
    };

    test("dist 의 html·css·js 에 외부 서체 주소와 Bootstrap CSS 흔적이 없다", () => {
        const texts = collectFiles(distDir).filter((file) => path.extname(file) in FORBIDDEN);
        expect(texts.some((file) => file.endsWith(".css"))).toBe(true);
        expect(texts.some((file) => file.endsWith(".js"))).toBe(true);
        for(const file of texts) {
            const content = fs.readFileSync(file, "utf8");
            const found = FORBIDDEN[path.extname(file)].filter((pattern) => pattern.test(content)).map(String);
            expect({file: path.relative(root, file), found}).toEqual({file: path.relative(root, file), found: []});
        }
    });

    test("금지 패턴이 원래의 Bootstrap CSS 배너를 실제로 잡는다", () => {
        const banner = "/*!\n * Bootstrap  v5.3.1 (https://getbootstrap.com/)\n */";
        expect(FORBIDDEN[".js"].some((pattern) => pattern.test(banner))).toBe(true);
        expect(FORBIDDEN[".css"].some((pattern) => pattern.test(banner))).toBe(true);
    });
});

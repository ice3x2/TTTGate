import * as fs from "fs";
import * as path from "path";

const root = path.resolve(__dirname, "../..");
const appCssPath = path.join(root, "admin/src/app.css");
const appCss = fs.readFileSync(appCssPath, "utf8");

const TOKENS = ['--bg-0','--bg-1','--bg-2','--bg-3','--bg-mute','--line-0','--line-1','--line-2','--ink-0','--ink-1','--ink-2','--ink-3',
    '--signal','--signal-fill','--signal-dim','--signal-glow','--pulse','--pulse-fill','--pulse-dim','--pulse-glow','--alarm','--alarm-fill','--alarm-dim','--alarm-glow',
    '--trace','--trace-dim','--trace-glow','--warn','--ff-display','--ff-ui','--ff-mono','--fs-xs','--fs-sm','--fs-md','--fs-lg','--fs-xl','--fs-2xl','--fs-3xl','--fs-4xl','--fs-hero',
    '--lh-tight','--lh-snug','--lh-body','--s-1','--s-2','--s-3','--s-4','--s-5','--s-6','--s-7','--s-8','--s-9','--s-10','--s-11','--s-12','--r-0','--r-1','--r-2','--r-3',
    '--dur-1','--dur-2','--dur-3','--dur-4','--ease-out','--ease-in'];

// R1: admin/src/ui/ 의 부품은 fetch·adminRequest·컨트롤러 import 를 쓰지 않는다.
describe("R1: ui 부품의 네트워크·컨트롤러 호출 부재", () => {
    const uiDir = path.join(root, "admin/src/ui");
    const FORBIDDEN = /fetch\(|adminRequest|from ["']\.\.\/controller/;

    const collectFiles = (dir: string): string[] => {
        if(!fs.existsSync(dir)) return [];
        const entries = fs.readdirSync(dir, {withFileTypes: true});
        let files: string[] = [];
        for(const entry of entries) {
            const full = path.join(dir, entry.name);
            if(entry.isDirectory()) { files = files.concat(collectFiles(full)); continue; }
            if(entry.name.endsWith(".svelte") || entry.name.endsWith(".ts")) files.push(full);
        }
        return files;
    };

    test("admin/src/ui 디렉터리가 존재한다", () => {
        expect(fs.existsSync(uiDir)).toBe(true);
    });

    const targets = collectFiles(uiDir);

    test.each(targets.map((file) => [path.relative(root, file), file] as const))("%s 에 fetch·adminRequest·컨트롤러 import 가 없다", (_label, file) => {
        const content = fs.readFileSync(file, "utf8");
        expect(FORBIDDEN.test(content)).toBe(false);
    });
});

// R2: admin/src 아래 모든 .svelte 파일(App.svelte 포함)에 hex 색상 리터럴이 없다(#92 U1-10 이 범위를 넓혔다).
describe("R2: hex 색상 리터럴 부재", () => {
    const HEX_PATTERN = /(?<![\w-])#[0-9a-fA-F]{3,8}(?![\w-])/;

    const collectSvelteFiles = (dir: string): string[] => {
        if(!fs.existsSync(dir)) return [];
        const entries = fs.readdirSync(dir, {withFileTypes: true});
        let files: string[] = [];
        for(const entry of entries) {
            const full = path.join(dir, entry.name);
            if(entry.isDirectory()) { files = files.concat(collectSvelteFiles(full)); continue; }
            if(entry.name.endsWith(".svelte")) files.push(full);
        }
        return files;
    };

    const targets = collectSvelteFiles(path.join(root, "admin/src"));

    test("App.svelte 와 ui·shell·screens 의 부품이 검사 대상에 들어 있다", () => {
        const relative = targets.map((file) => path.relative(root, file).split(path.sep).join("/"));
        expect(relative).toContain("admin/src/App.svelte");
        for(const dir of ["ui", "shell", "screens"]) {
            expect(relative.some((file) => file.startsWith(`admin/src/${dir}/`))).toBe(true);
        }
    });

    test.each(targets.map((file) => [path.relative(root, file), file] as const))("%s 에 hex 색상 리터럴이 없다", (_label, file) => {
        const content = fs.readFileSync(file, "utf8");
        expect(HEX_PATTERN.test(content)).toBe(false);
    });
});

// R3: :root 블록 안에 TOKENS 전부가 정의되어 있고, --ff-kr-* 별칭은 없다.
describe("R3: app.css :root 토큰 계약", () => {
    const rootBlockMatch = appCss.match(/:root\s*\{([\s\S]*?)\n\}/);
    const rootBlock = rootBlockMatch ? rootBlockMatch[1] : "";

    test(":root 블록이 존재한다", () => {
        expect(rootBlockMatch).not.toBeNull();
    });

    test.each(TOKENS)("토큰 %s 가 :root 블록 안에 정의되어 있다", (token) => {
        const re = new RegExp(`(^|[^-\\w])${token.replace(/[-]/g, "\\-")}\\s*:`);
        expect(re.test(rootBlock)).toBe(true);
    });

    test("--ff-kr-display 별칭은 정의되어 있지 않다", () => {
        expect(rootBlock.includes("--ff-kr-display")).toBe(false);
    });

    test("--ff-kr-ui 별칭은 정의되어 있지 않다", () => {
        expect(rootBlock.includes("--ff-kr-ui")).toBe(false);
    });
});

// R4: admin/src 전체에서 `max-width: 1024px` 를 쓰는 파일은 Shell.svelte 하나뿐이다.
describe("R4: 본문 최대 너비 선언의 단일 위치", () => {
    const EXTENSIONS = new Set([".svelte", ".css", ".ts"]);

    const collectFiles = (dir: string): string[] => {
        if(!fs.existsSync(dir)) return [];
        const entries = fs.readdirSync(dir, {withFileTypes: true});
        let files: string[] = [];
        for(const entry of entries) {
            const full = path.join(dir, entry.name);
            if(entry.isDirectory()) { files = files.concat(collectFiles(full)); continue; }
            if(EXTENSIONS.has(path.extname(entry.name))) files.push(full);
        }
        return files;
    };

    test("`max-width: 1024px` 를 포함하는 파일이 admin/src/shell/Shell.svelte 하나다", () => {
        const owners = collectFiles(path.join(root, "admin/src"))
            .filter((file) => fs.readFileSync(file, "utf8").includes("max-width: 1024px"))
            .map((file) => path.relative(root, file).split(path.sep).join("/"))
            .sort();
        expect(owners).toEqual(["admin/src/shell/Shell.svelte"]);
    });
});

// R5: admin/src 와 admin/index.html 의 텍스트 파일에 외부 URL(http/https)이 없다.
// 영구 예외는 서체 라이선스 원문 하나뿐이다(#92 U1-10 이 임시 제외를 지웠다).
describe("R5: 외부 요청 URL 부재", () => {
    const excludedFiles = [
        path.join(root, "admin/src/assets/fonts/LICENSE.md"),
    ];
    const textExtensions = new Set([".svelte", ".ts", ".js", ".css", ".html", ".md", ".json", ".svg", ".map"]);

    const collectTextFiles = (dir: string): string[] => {
        const entries = fs.readdirSync(dir, {withFileTypes: true});
        let files: string[] = [];
        for(const entry of entries) {
            const full = path.join(dir, entry.name);
            if(entry.isDirectory()) { files = files.concat(collectTextFiles(full)); continue; }
            if(excludedFiles.includes(full)) continue;
            if(textExtensions.has(path.extname(entry.name))) files.push(full);
        }
        return files;
    };

    const targets = [...collectTextFiles(path.join(root, "admin/src")), path.join(root, "admin/index.html")];

    test.each(targets.map((file) => [path.relative(root, file), file] as const))("%s 에 http(s):// 요청이 없다", (_label, file) => {
        const content = fs.readFileSync(file, "utf8");
        expect(/https?:\/\//.test(content)).toBe(false);
    });
});

// R6: 단위 1 이 지운 옛 파일이 다시 생기지 않는다(#92 U1-10).
describe("R6: 옛 부품·부산물 부재", () => {
    const REMOVED = [
        "admin/src/css", "admin/src/layout", "admin/src/component", "admin/src/lib",
        "admin/src/main.js", "admin/src/main.js.map",
        "admin/src/assets/svelte.svg", "admin/src/assets/cpu.png", "admin/src/assets/uptime.png",
        "admin/src/assets/infinity.png", "admin/src/assets/icon.png",
    ];

    test.each(REMOVED)("%s 가 존재하지 않는다", (relative) => {
        expect(fs.existsSync(path.join(root, relative))).toBe(false);
    });

    test("admin/src 의 최상위 항목이 정해진 목록과 같다", () => {
        const entries = fs.readdirSync(path.join(root, "admin/src")).sort();
        expect(entries).toEqual(["App.svelte", "app.css", "assets", "controller", "main.ts", "router.ts", "screens", "shell", "ui", "util", "vite-env.d.ts"].sort());
    });

    test("loading.png 는 ui/Loading.svelte 가 쓰므로 남아 있다", () => {
        expect(fs.existsSync(path.join(root, "admin/src/assets/loading.png"))).toBe(true);
    });
});

// R7: admin/src/assets/fonts 에 woff2 7개 + LICENSE.md 가 있고, 각 woff2 는 1KB 초과 64KB 이하.
describe("R7: 번들 서체 파일", () => {
    const fontsDir = path.join(root, "admin/src/assets/fonts");
    const expectedFiles = [
        "noto-serif-latin-400.woff2", "noto-serif-latin-600.woff2",
        "noto-sans-latin-400.woff2", "noto-sans-latin-500.woff2", "noto-sans-latin-700.woff2",
        "jetbrains-mono-latin-400.woff2", "jetbrains-mono-latin-500.woff2",
    ];

    test.each(expectedFiles)("%s 가 존재하고 1KB 초과 64KB 이하다", (fileName) => {
        const filePath = path.join(fontsDir, fileName);
        expect(fs.existsSync(filePath)).toBe(true);
        const size = fs.statSync(filePath).size;
        expect(size).toBeGreaterThan(1024);
        expect(size).toBeLessThanOrEqual(64 * 1024);
    });

    test("LICENSE.md 가 존재한다", () => {
        expect(fs.existsSync(path.join(fontsDir, "LICENSE.md"))).toBe(true);
    });
});

import * as fs from "fs";
import * as path from "path";
import {parse as parseYaml} from "yaml";

// #322: Windows 런처(Tauri)는 Windows 에서만 빌드된다. 런처나 빌드 스크립트가 바뀌면 Windows 러너에서
// Rust 단위 테스트를 돌리고 릴리스와 같은 명령으로 빌드해 크기(NFR-1)를 본다.
const root = path.resolve(__dirname, "../..");
const workflow = parseYaml(fs.readFileSync(path.join(root, ".github/workflows/windows-launcher.yml"), "utf8"));
const WATCHED = ["launcher/**", "scripts/build-launcher.cjs", "package.json", ".github/workflows/windows-launcher.yml"];

describe("Windows launcher workflow (#322)", () => {
    const job = workflow.jobs["windows-launcher"];
    const steps: any[] = job.steps;
    const runs: string[] = steps.filter((step) => step.run).map((step) => step.run.trim());

    test("runs on pull requests and pushes that change the launcher", () => {
        expect(workflow.on.pull_request.paths).toEqual(WATCHED);
        expect(workflow.on.push.branches).toEqual(["main", "develop"]);
        expect(workflow.on.push.paths).toEqual(WATCHED);
        expect(workflow.permissions).toEqual({contents: "read"});
        expect(workflow.concurrency).toEqual({group: "windows-launcher-${{ github.ref }}", "cancel-in-progress": true});
    });

    test("tests the Rust code and builds the launcher with the release command on Windows", () => {
        expect(job["runs-on"]).toBe("windows-latest");
        const test = steps.find((step) => step.run?.trim() === "cargo test --locked");
        expect(test?.["working-directory"]).toBe("launcher/src-tauri");
        expect(runs).toContain("node scripts/build-launcher.cjs launcher-out");
    });

    test("AC-7 fails when the launcher is larger than 15 MB", () => {
        expect(runs.some((run) => run.includes("launcher-out/TTTGate-launcher-win-x64.exe") && run.includes("15728640"))).toBe(true);
    });

    test("caches the cargo registry and the build output", () => {
        const cache = steps.find((step) => String(step.uses ?? "").startsWith("actions/cache@"));
        expect(cache?.with?.path).toContain("launcher/src-tauri/target");
        expect(cache?.with?.key).toMatch(/hashFiles\('launcher\/src-tauri\/Cargo\.lock'/);
    });
});

// NFR-4: 런처 화면은 외부 네트워크에서 아무것도 받지 않는다.
describe("launcher UI loads nothing from the network (#322 NFR-4)", () => {
    const uiDir = path.join(root, "launcher", "ui");
    const files = fs.readdirSync(uiDir).filter((name) => /\.(html|js|css)$/.test(name));
    const config = JSON.parse(fs.readFileSync(path.join(root, "launcher", "src-tauri", "tauri.conf.json"), "utf8"));

    test("the content security policy allows only the app itself and the IPC bridge", () => {
        const csp: string = config.app.security.csp;
        expect(csp).toContain("default-src 'self'");
        expect(csp).toMatch(/connect-src ipc: http:\/\/ipc\.localhost(;|$)/);
        expect(csp).not.toMatch(/https?:\/\/(?!ipc\.localhost)/);
    });

    test("no UI file loads a remote resource or opens a network request", () => {
        expect(files.length).toBeGreaterThan(0);
        for(const name of files) {
            const text = fs.readFileSync(path.join(uiDir, name), "utf8");
            expect({name, remote: /(src|href)\s*=\s*["']?\s*(https?:)?\/\//i.test(text) || /url\(\s*["']?(https?:)?\/\//i.test(text)}).toEqual({name, remote: false});
            expect({name, request: /\b(fetch|XMLHttpRequest|WebSocket|EventSource)\b/.test(text)}).toEqual({name, request: false});
        }
    });
});

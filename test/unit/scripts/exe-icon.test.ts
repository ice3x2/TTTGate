import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {spawnSync} from "child_process";

// #321: Windows 실행 파일에 붉은 터널 아이콘을 넣는다. pkg 가 만든 .exe 는 Node.js 의 아이콘을 그대로 가지므로,
// 빌드 뒤에 resedit 으로 아이콘 리소스를 바꾼다(pkg 문서 "Injecting Windows executable metadata after packaging").
const ResEdit = require("resedit");
const {setExeIcon, EXE_ICON_FILE} = require("../../../scripts/set-exe-icon.cjs");

const root = path.resolve(__dirname, "../../..");
const SCRIPT = path.join(root, "scripts", "set-exe-icon.cjs");
const ICON_SIZES = [16, 24, 32, 48, 64, 128, 256];
const RT_ICON = 3;

/** .ico 의 너비 값은 0 이 256 을 뜻한다. */
const widthsOf = (icons: Array<{width: number}>) => icons.map((icon) => icon.width === 0 ? 256 : icon.width).sort((a, b) => a - b);
const iconsOfFile = () => ResEdit.Data.IconFile.from(fs.readFileSync(EXE_ICON_FILE)).icons.map((icon: any) => icon.data);
const resourceOf = (file: string) => ResEdit.NtExecutableResource.from(ResEdit.NtExecutable.from(fs.readFileSync(file)));

/** 빈 Windows 실행 파일을 만든다. icons 를 주면 그 아이콘 그룹을 미리 넣는다(Node 의 원래 아이콘 흉내). */
const writeExe = (file: string, icons?: unknown[]) => {
    const exe = ResEdit.NtExecutable.createEmpty(false, false);
    if(icons) {
        const resource = ResEdit.NtExecutableResource.from(exe);
        ResEdit.Resource.IconGroupEntry.replaceIconsForResource(resource.entries, 1, 1033, icons);
        resource.outputResource(exe);
    }
    fs.writeFileSync(file, Buffer.from(exe.generate()));
};

describe("Windows executable icon (#321)", () => {
    let dir: string;
    beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), "exe-icon-")); });
    afterEach(() => fs.rmSync(dir, {recursive: true, force: true}));

    test("the icon file is the console favicon and holds seven sizes from 16 to 256 px", () => {
        expect(path.relative(root, EXE_ICON_FILE).split(path.sep).join("/")).toBe("admin/public/favicon.ico");
        expect(widthsOf(iconsOfFile())).toEqual(ICON_SIZES);
    });

    test("setExeIcon replaces an existing icon group and leaves no stale icon images", () => {
        const exePath = path.join(dir, "TTTGate-win-x64.exe");
        writeExe(exePath, iconsOfFile().slice(0, 2));
        setExeIcon(exePath);
        const resource = resourceOf(exePath);
        const groups = ResEdit.Resource.IconGroupEntry.fromEntries(resource.entries);
        expect(groups).toHaveLength(1);
        expect(widthsOf(groups[0].icons)).toEqual(ICON_SIZES);
        expect(resource.entries.filter((entry: any) => entry.type === RT_ICON)).toHaveLength(ICON_SIZES.length);
    });

    test("setExeIcon keeps the data that pkg appends to the executable at the same place", () => {
        const exePath = path.join(dir, "TTTGate-win-x64.exe");
        writeExe(exePath, iconsOfFile());
        const payload = Buffer.from("PKG-PAYLOAD".repeat(1000));
        fs.appendFileSync(exePath, payload);
        const before = fs.statSync(exePath).size;
        setExeIcon(exePath);
        const after = fs.readFileSync(exePath);
        expect(after.length).toBe(before);
        expect(after.subarray(after.length - payload.length).equals(payload)).toBe(true);
    });

    // 릴리스는 Linux 에서 Windows 실행 파일을 고친다. 파일을 바꿔치기해도 원래 권한을 그대로 둔다.
    (process.platform === "win32" ? test.skip : test)("setExeIcon keeps the file mode", () => {
        const exePath = path.join(dir, "TTTGate-win-x64.exe");
        writeExe(exePath, iconsOfFile().slice(0, 1));
        fs.chmodSync(exePath, 0o755);
        setExeIcon(exePath);
        expect(fs.statSync(exePath).mode & 0o777).toBe(0o755);
    });

    test("setExeIcon refuses a change that would move the appended data and leaves the file as it was", () => {
        const exePath = path.join(dir, "TTTGate-win-x64.exe");
        writeExe(exePath);
        fs.appendFileSync(exePath, Buffer.from("PKG-PAYLOAD".repeat(1000)));
        const original = fs.readFileSync(exePath);
        expect(() => setExeIcon(exePath)).toThrow(/appended data/);
        expect(fs.readFileSync(exePath).equals(original)).toBe(true);
    });

    test("setExeIcon fails on a file that is not a Windows executable", () => {
        const notExe = path.join(dir, "TTTGate-linux-x64");
        fs.writeFileSync(notExe, Buffer.from("\x7fELF not a PE file"));
        expect(() => setExeIcon(notExe)).toThrow();
    });

    describe("command line: node scripts/set-exe-icon.cjs <bin dir>", () => {
        const run = (binDir: string, ...rest: string[]) => spawnSync(process.execPath, [SCRIPT, binDir, ...rest], {encoding: "utf8", timeout: 30_000});

        test("sets the icon on every Windows binary that pkg builds", () => {
            for(const name of ["TTTGate-win-x64.exe", "TTTGate-win-arm64.exe"]) writeExe(path.join(dir, name), iconsOfFile().slice(0, 1));
            fs.writeFileSync(path.join(dir, "TTTGate-linux-x64"), "ELF");
            const result = run(dir);
            expect({status: result.status, stderr: result.stderr}).toEqual({status: 0, stderr: ""});
            for(const name of ["TTTGate-win-x64.exe", "TTTGate-win-arm64.exe"]) {
                expect(widthsOf(ResEdit.Resource.IconGroupEntry.fromEntries(resourceOf(path.join(dir, name)).entries)[0].icons)).toEqual(ICON_SIZES);
            }
        });

        test("fails when a Windows binary that pkg should build is missing", () => {
            writeExe(path.join(dir, "TTTGate-win-x64.exe"));
            expect(run(dir).status).not.toBe(0);
            expect(run(path.join(dir, "missing")).status).not.toBe(0);
        });

        // CI 의 아이콘 확인 작업은 win-x64 하나만 만든다. 그때는 기대하는 수를 인자로 준다.
        test("accepts the expected number of Windows binaries as a second argument", () => {
            writeExe(path.join(dir, "TTTGate-win-x64.exe"), iconsOfFile().slice(0, 1));
            const result = run(dir, "1");
            expect({status: result.status, stderr: result.stderr}).toEqual({status: 0, stderr: ""});
            expect(run(dir, "2").status).not.toBe(0);
            expect(run(dir, "zero").status).not.toBe(0);
        });
    });
});

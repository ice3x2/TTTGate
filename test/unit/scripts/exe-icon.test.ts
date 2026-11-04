import * as fs from "fs";
import * as os from "os";
import * as path from "path";

// #321: Windows 실행 파일에 붉은 터널 아이콘을 넣는다. pkg 가 만든 .exe 는 Node.js 의 아이콘을 그대로 가지므로,
// 빌드 뒤에 resedit 으로 아이콘 리소스를 바꾼다(pkg 문서 "Injecting Windows executable metadata after packaging").
// eslint-disable-next-line @typescript-eslint/no-require-imports
const ResEdit = require("resedit");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const {setExeIcon, EXE_ICON_FILE} = require("../../../scripts/set-exe-icon.cjs");

const root = path.resolve(__dirname, "../../..");
const ICON_SIZES = [16, 24, 32, 48, 64, 128, 256];

/** .ico 의 너비 값은 0 이 256 을 뜻한다. */
const widthsOf = (icons: Array<{width: number}>) => icons.map((icon) => icon.width === 0 ? 256 : icon.width).sort((a, b) => a - b);

describe("Windows executable icon (#321)", () => {
    let dir: string;
    beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), "exe-icon-")); });
    afterEach(() => fs.rmSync(dir, {recursive: true, force: true}));

    test("the icon file is the console favicon and holds seven sizes from 16 to 256 px", () => {
        expect(path.relative(root, EXE_ICON_FILE).split(path.sep).join("/")).toBe("admin/public/favicon.ico");
        const ico = ResEdit.Data.IconFile.from(fs.readFileSync(EXE_ICON_FILE));
        expect(widthsOf(ico.icons.map((icon: any) => icon.data))).toEqual(ICON_SIZES);
    });

    test("setExeIcon writes the icon group into a Windows executable", () => {
        const exePath = path.join(dir, "sample.exe");
        fs.writeFileSync(exePath, Buffer.from(ResEdit.NtExecutable.createEmpty(false, false).generate()));
        setExeIcon(exePath);
        const exe = ResEdit.NtExecutable.from(fs.readFileSync(exePath));
        const groups = ResEdit.Resource.IconGroupEntry.fromEntries(ResEdit.NtExecutableResource.from(exe).entries);
        expect(groups).toHaveLength(1);
        expect(widthsOf(groups[0].icons)).toEqual(ICON_SIZES);
    });

    test("setExeIcon fails on a file that is not a Windows executable, so a build cannot ship without the icon", () => {
        const notExe = path.join(dir, "TTTGate-linux-x64");
        fs.writeFileSync(notExe, Buffer.from("\x7fELF not a PE file"));
        expect(() => setExeIcon(notExe)).toThrow();
    });

    test("deploy.js sets the icon on every Windows binary after pkg", () => {
        const deploy = fs.readFileSync(path.join(root, "deploy.js"), "utf8");
        expect(deploy).toMatch(/require\(['"]\.\/scripts\/set-exe-icon\.cjs['"]\)/);
        expect(deploy).toMatch(/setExeIcon\(/);
        // pkg 설정의 Windows 대상이 모두 .exe 로 나온다. deploy.js 는 dist/bin 의 .exe 를 모두 고친다.
        const targets: string[] = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).pkg.targets;
        expect(targets.filter((target) => target.includes("-win-"))).toEqual(["node24-win-arm64", "node24-win-x64"]);
    });
});

import {execFileSync} from "child_process";
import fs from "fs";
import path from "path";

// #330: Windows Git(core.autocrlf=true)이 체크아웃하면 줄 끝 규칙이 없는 텍스트 파일을 CRLF 로 쓴다.
// 같은 폴더를 쓰는 WSL git 은 그것을 변경으로 본다. .gitattributes 가 모든 텍스트 파일을 LF 로 고정해야 한다.
const root = path.resolve(__dirname, "../..");
const git = (args: string[], input?: string): string =>
    execFileSync("git", args, {cwd: root, encoding: "utf8", input, maxBuffer: 64 * 1024 * 1024});

type Attributes = {text: string; eol: string};

const attributesOfTrackedFiles = (): Map<string, Attributes> => {
    const files = git(["ls-files", "-z"]).split("\0").filter(Boolean);
    const output = git(["check-attr", "-z", "--stdin", "text", "eol"], files.join("\0"));
    // -z 출력은 "경로 NUL 속성 NUL 값 NUL" 의 반복이다.
    const fields = output.split("\0");
    const attributes = new Map<string, Attributes>();
    for(let i = 0; i + 2 < fields.length; i += 3) {
        const [file, name, value] = [fields[i], fields[i + 1], fields[i + 2]];
        const entry = attributes.get(file) ?? {text: "unspecified", eol: "unspecified"};
        if(name === "text") entry.text = value;
        if(name === "eol") entry.eol = value;
        attributes.set(file, entry);
    }
    return attributes;
};

test("REQ-1 every tracked text file is checked out with LF, whatever core.autocrlf says", () => {
    const notLf = [...attributesOfTrackedFiles()]
        .filter(([, attributes]) => attributes.text !== "unset" && attributes.eol !== "lf")
        .map(([file]) => file);
    expect(notLf).toEqual([]);
});

test("REQ-1 ordinary text files are text=auto with eol=lf", () => {
    // 누가 규칙을 `* -text` 나 `* binary` 로 바꾸면 위 시험은 모든 파일을 걸러 통과한다. 그것을 막는다.
    const attributes = attributesOfTrackedFiles();
    for(const file of ["README.md", "src/app.ts", "admin/src/App.svelte", "package.json"]) {
        expect(attributes.get(file)).toEqual({text: "auto", eol: "lf"});
    }
});

test("REQ-2 only the -text files of .gitattributes and the icons keep their bytes", () => {
    const declared = fs.readFileSync(path.join(root, ".gitattributes"), "utf8").split(/\r?\n/)
        .map((line) => line.trim().split(/\s+/))
        .filter(([pattern, attribute]) => pattern && !pattern.startsWith("#") && attribute === "-text")
        .map(([pattern]) => pattern);
    const attributes = attributesOfTrackedFiles();
    const icons = [...attributes.keys()].filter((file) => file.endsWith(".ico"));
    expect(icons.length).toBeGreaterThan(0);
    const unset = [...attributes].filter(([, value]) => value.text === "unset").map(([file]) => file).sort();
    expect(unset).toEqual([...declared, ...icons].sort());
});

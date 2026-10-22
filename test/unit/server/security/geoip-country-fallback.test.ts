import fs from "fs";
import os from "os";
import path from "path";

// U5-10 / #126 — pkg 바이너리에는 country DB 두 파일만 들어간다. city DB 가 없는 디렉터리에서도
// geoip-lite 가 country 로 폴백해 국가 코드를 돌려준다는 사실을 고정한다.
const root = path.resolve(__dirname, "../../../..");
const source = path.join(root, "node_modules/geoip-lite/data");
const bundled = ["geoip-country.dat", "geoip-country6.dat"];

const directories: string[] = [];
let previous: string | undefined;

// 지정한 파일만 담은 임시 데이터 디렉터리를 만들어 GEODATADIR 로 지정한다.
// geoip-lite 는 모듈 로드 시점에 데이터 디렉터리를 한 번 정하므로 require 보다 먼저 설정해야 한다.
const dataDirectory = (files: string[]): string => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "geoip country "));
    directories.push(directory);
    for(const file of files) fs.copyFileSync(path.join(source, file), path.join(directory, file));
    process.env.GEODATADIR = directory;
    return directory;
};

beforeEach(() => { previous = process.env.GEODATADIR; });

afterEach(() => {
    if(previous === undefined) delete process.env.GEODATADIR; else process.env.GEODATADIR = previous;
    while(directories.length > 0) fs.rmSync(directories.pop() as string, {recursive: true, force: true});
});

test("country databases alone resolve a public address and reject a private one", () => {
    const directory = dataDirectory(bundled);
    expect(fs.readdirSync(directory).sort()).toEqual([...bundled].sort());
    jest.isolateModules(() => {
        const geoip = require("geoip-lite");
        expect(geoip.lookup("8.8.8.8")?.country).toMatch(/^[A-Z]{2}$/);
        expect(geoip.lookup("127.0.0.1")).toBeNull();
    });
});

// 위 케이스가 기본 데이터 디렉터리(city DB 포함)를 읽고도 통과하지 않도록, GEODATADIR 이 실제로
// 적용되어야만 성립하는 케이스를 둔다. 빈 디렉터리에서는 모듈 로드 시점의 preload 가 country DB 를
// 열지 못해 ENOENT 로 실패한다.
test("the data directory really comes from GEODATADIR", () => {
    const directory = dataDirectory([]);
    jest.isolateModules(() => {
        expect(() => require("geoip-lite")).toThrow(path.join(directory, "geoip-country.dat"));
    });
});

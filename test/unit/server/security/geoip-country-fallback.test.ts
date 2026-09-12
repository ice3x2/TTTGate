import fs from "fs";
import os from "os";
import path from "path";

// U5-10 / #126 — pkg 바이너리에는 country DB 두 파일만 들어간다. city DB 가 없는 디렉터리에서도
// geoip-lite 가 country 로 폴백해 국가 코드를 돌려준다는 사실을 고정한다.
const root = path.resolve(__dirname, "../../../..");
const source = path.join(root, "node_modules/geoip-lite/data");
const bundled = ["geoip-country.dat", "geoip-country6.dat"];

let directory = "";
let previous: string | undefined;

beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), "geoip country "));
    for(const file of bundled) fs.copyFileSync(path.join(source, file), path.join(directory, file));
    previous = process.env.GEODATADIR;
    // geoip-lite 는 모듈 로드 시점에 데이터 디렉터리를 한 번 정하므로 require 보다 먼저 설정해야 한다.
    process.env.GEODATADIR = directory;
});

afterEach(() => {
    if(previous === undefined) delete process.env.GEODATADIR; else process.env.GEODATADIR = previous;
    fs.rmSync(directory, {recursive: true, force: true});
});

test("country databases alone resolve a public address and reject a private one", () => {
    expect(fs.readdirSync(directory).sort()).toEqual([...bundled].sort());
    jest.isolateModules(() => {
        const geoip = require("geoip-lite");
        expect(geoip.lookup("8.8.8.8")?.country).toMatch(/^[A-Z]{2}$/);
        expect(geoip.lookup("127.0.0.1")).toBeNull();
    });
});

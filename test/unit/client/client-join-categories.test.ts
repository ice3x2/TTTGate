import * as fs from "fs";
import * as os from "os";
import * as path from "path";

// #322 AC-9: 서버가 돌려준 실패 종류는 그대로 category 로 나온다. 실제 서버로 만들기 어려운 종류는 등록 요청을 바꿔 끼워 본다.
jest.mock("../../../src/client/ClientEnrollment", () => ({requestEnrollment: jest.fn()}));
// eslint-disable-next-line @typescript-eslint/no-var-requires
const {requestEnrollment} = require("../../../src/client/ClientEnrollment");
import {runClientJoin} from "../../../src/client/ClientJoin";

describe("client join --json failure categories", () => {
    test.each(["throttled", "unavailable", "proof", "rejected", "network"])("%s is reported as it is, with exit code 1", async (category) => {
        (requestEnrollment as jest.Mock).mockResolvedValue({ok: false, category, message: `m-${category}`});
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "join-category-"));
        const out: string[] = [];
        try {
            const code = "7Q4K-M2XP-AB01";
            const exit = await runClientJoin("gw.example:9126", {code, json: ""},
                {configDir: dir, out: (line) => out.push(line), err: (line) => out.push(line), readInput: () => ""});
            expect(exit).toBe(1);
            expect(JSON.parse(out[0])).toEqual({ok: false, category, message: `enrollment failed: m-${category}`});
            expect(out.join("\n")).not.toContain(code);
            expect(fs.readdirSync(dir)).toEqual([]);
        } finally {
            fs.rmSync(dir, {recursive: true, force: true});
        }
    });
});

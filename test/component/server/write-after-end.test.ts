import path from "path";
import {spawnSync} from "child_process";

jest.setTimeout(90_000);

// #260 — 인증 전 연결의 [Message, SyncCtrl] 묶음이 서버 프로세스를 끝내지 않는다(AC-1, AC-4).
test("an unauthenticated [Message, SyncCtrl] chunk does not crash the server and leaves no pending handshake", () => {
    const result = spawnSync(process.execPath, ["-r", "ts-node/register/transpile-only",
        path.join(__dirname, "write-after-end-driver.ts")],
        {cwd: path.join(__dirname, "../../.."), encoding: "utf8", timeout: 75_000});
    // 로거는 stdout 으로 쓰므로 두 출력을 모두 본다.
    const crash = (result.stdout + result.stderr).split(/\r?\n/).filter((line) => /ERR_STREAM_WRITE_AFTER_END|Unhandled|uncaught/i.test(line)).slice(0, 3);
    expect({status: result.status, crash}).toEqual({status: 0, crash: []});
    const summary = JSON.parse(result.stdout.trim().split(/\r?\n/).filter((line) => line.includes("SURVIVED")).pop() ?? "{}");
    expect(summary).toEqual({result: "SURVIVED", alive: true, pending: 0});
});

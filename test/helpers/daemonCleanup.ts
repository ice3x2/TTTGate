import * as fs from "fs";
import * as path from "path";
import {spawnProcess} from "./smokeProcess";

const PID_FILES = [".pid_app", ".pid_sentinel", ".pid_foreground"];

const isAlive = (pid: number): boolean => {
    try {
        process.kill(pid, 0);
        return true;
    } catch (e) {
        return (e as NodeJS.ErrnoException).code === "EPERM";
    }
};

/** PID 파일 한 줄의 pid. 새 형식은 JSON 한 줄({"pid": …})이고 예전 형식은 숫자만 있다(#256). */
const pidOfLine = (line: string): number => {
    const text = line.trim();
    // 운영 코드(Sentinel.readPIDFile)와 같게 읽는다: 숫자 줄은 parseInt, JSON 줄은 숫자 pid 만.
    if(!text.startsWith("{")) return parseInt(text, 10);
    try {
        const pid = (JSON.parse(text) as {pid?: unknown}).pid;
        return typeof pid === "number" ? pid : NaN;
    } catch { return NaN; }
};

/** rootDir/bin 의 PID 파일에 적힌 PID 들(테스트가 띄운 데몬 프로세스). */
const recordedDaemonPids = (rootDir: string): number[] => PID_FILES
    .map((name) => path.join(rootDir, "bin", name))
    .filter((file) => fs.existsSync(file))
    .flatMap((file) => fs.readFileSync(file, "utf-8").split("\n"))
    .filter((line) => line.trim() !== "")
    .map(pidOfLine)
    .filter((pid) => Number.isSafeInteger(pid) && pid > 0 && pid !== process.pid);

/**
 * `app.js stop` 으로 데몬을 멈추고, 기록된 PID 가 모두 끝났는지 확인한다(#227 REQ-2).
 * 남은 프로세스가 있으면 끝내고 그 PID 를 돌려준다. 호출자는 빈 배열인지 단언한다.
 */
const stopDaemon = async (appJs: string, rootDir: string, timeoutMs = 15_000): Promise<number[]> => {
    const pids = recordedDaemonPids(rootDir);
    const stop = spawnProcess(process.execPath, [appJs, "stop"], {cwd: rootDir});
    await stop.waitForExit(timeoutMs).catch(() => undefined);
    const deadline = Date.now() + timeoutMs;
    while(Date.now() < deadline && pids.some(isAlive)) {
        await new Promise((resolve) => setTimeout(resolve, 100));
    }
    const leftover = pids.filter(isAlive);
    for(const pid of leftover) {
        try { process.kill(pid, "SIGKILL"); } catch { /* 이미 끝남 */ }
    }
    return leftover;
};

export {stopDaemon, recordedDaemonPids, isAlive};

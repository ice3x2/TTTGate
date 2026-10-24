import fs from "fs";
import os from "os";
import path from "path";
import {spawnSync} from "child_process";
import {FileCache} from "../../../src/util/FileCache";

// #258 — 캐시 파일은 기록이 모두 빠지면 0 으로 줄고, 시작할 때 죽은 프로세스가 남긴 캐시 파일을 지운다.
describe("file cache cleanup (#258)", () => {
    let directory: string;
    beforeEach(() => { directory = fs.mkdtempSync(path.join(os.tmpdir(), "file-cache-cleanup-")); });
    afterEach(() => { fs.rmSync(directory, {recursive: true, force: true}); });

    // REQ-1 / AC-1 — 핸들러가 열린 채로 넘친 기록을 모두 읽어 내면 디스크도 비운다.
    test("the cache file shrinks to zero once every record is removed", () => {
        const cache = FileCache.create(directory);
        try {
            const ids = Array.from({length: 9}, () => cache.writeSync(Buffer.alloc(1024 * 1024, 7)).id);
            expect(fs.statSync(cache.filePath).size).toBeGreaterThanOrEqual(9 * 1024 * 1024);
            ids.forEach((id) => expect(cache.remove(id)).toBe(true));
            expect(fs.statSync(cache.filePath).size).toBe(0);
            // 비운 뒤에도 그대로 쓰고 읽는다.
            const again = cache.writeSync(Buffer.from("after-truncate"));
            expect(cache.readSync(again.id)).toEqual(Buffer.from("after-truncate"));
        } finally {
            cache.deleteSync();
        }
    });

    // REQ-3 — 남은 기록이 있으면 줄이지 않는다.
    test("the cache file keeps its size while a record remains", () => {
        const cache = FileCache.create(directory);
        try {
            const first = cache.writeSync(Buffer.alloc(64 * 1024, 1));
            const second = cache.writeSync(Buffer.alloc(64 * 1024, 2));
            cache.remove(first.id);
            expect(fs.statSync(cache.filePath).size).toBeGreaterThanOrEqual(128 * 1024);
            expect(cache.readSync(second.id)).toEqual(Buffer.alloc(64 * 1024, 2));
        } finally {
            cache.deleteSync();
        }
    });

    // REQ-2 / AC-2 — 살아 있지 않은 PID 의 캐시 파일만 지운다.
    test("the startup sweep removes cache files of dead processes only", () => {
        const child = spawnSync(process.execPath, ["-e", "process.stdout.write(String(process.pid))"], {encoding: "utf-8"});
        const deadPid = Number(child.stdout);
        expect(Number.isInteger(deadPid) && deadPid > 0).toBe(true);
        const file = (pid: number, suffix = "1") => path.join(directory, `${pid}.260101000000.${suffix}.cache`);
        fs.writeFileSync(file(deadPid), "stale");
        fs.writeFileSync(file(process.ppid), "parent");
        fs.writeFileSync(path.join(directory, "notes.txt"), "not a cache file");
        fs.writeFileSync(path.join(directory, "abc.cache"), "no pid");
        // 이 프로세스가 지금 쓰는 캐시 파일은 남긴다.
        const mine = FileCache.create(directory);
        mine.writeSync(Buffer.from("mine"));
        try {
            const removed = FileCache.sweepStale(directory);
            expect(removed).toEqual([file(deadPid)]);
            expect(fs.existsSync(mine.filePath)).toBe(true);
        } finally {
            mine.deleteSync();
        }
        expect(fs.existsSync(file(deadPid))).toBe(false);
        expect(fs.existsSync(file(process.ppid))).toBe(true);
        expect(fs.existsSync(path.join(directory, "notes.txt"))).toBe(true);
        expect(fs.existsSync(path.join(directory, "abc.cache"))).toBe(true);
    });

    // REQ-2 — 다른 사용자의 살아 있는 프로세스(신호 권한 없음, EPERM)의 파일은 지우지 않는다.
    test("the startup sweep keeps the files of a live process owned by another user", () => {
        const otherPid = 4_000_000;
        const kill = jest.spyOn(process, "kill").mockImplementation(((pid: number) => {
            if(pid === otherPid) throw Object.assign(new Error("operation not permitted"), {code: "EPERM"});
            throw Object.assign(new Error("no such process"), {code: "ESRCH"});
        }) as any);
        try {
            const other = path.join(directory, `${otherPid}.260101000000.1.cache`);
            const dead = path.join(directory, `${otherPid + 1}.260101000000.1.cache`);
            fs.writeFileSync(other, "other user");
            fs.writeFileSync(dead, "dead");
            expect(FileCache.sweepStale(directory)).toEqual([dead]);
            expect(fs.existsSync(other)).toBe(true);
        } finally {
            kill.mockRestore();
        }
    });

    // REQ-2 — 같은 PID 로 다시 뜬 프로세스(컨테이너 재시작)는 이전 실행이 남긴 파일을 지운다.
    // 이 프로세스가 만들지 않은 자기 PID 이름의 파일은 이전 실행의 것이다.
    test("the startup sweep removes a file with the current pid that this process did not create", () => {
        const previousRun = path.join(directory, `${process.pid}.260101000000.1.cache`);
        fs.writeFileSync(previousRun, "previous run");
        expect(FileCache.sweepStale(directory)).toEqual([previousRun]);
        expect(fs.existsSync(previousRun)).toBe(false);
    });

    // REQ-2 — 지운 캐시 파일의 경로는 기록에서도 뺀다(기록이 계속 늘지 않게).
    test("deleting a cache file forgets its path", () => {
        const cache = FileCache.create(directory);
        const owned: Set<string> = (FileCache as any).OwnedPaths;
        expect(owned.has(path.resolve(cache.filePath))).toBe(true);
        cache.deleteSync();
        expect(owned.has(path.resolve(cache.filePath))).toBe(false);
    });

    // REQ-2 — 폴더가 없으면 아무 일도 하지 않는다.
    test("the startup sweep ignores a missing directory", () => {
        expect(FileCache.sweepStale(path.join(directory, "missing"))).toEqual([]);
    });
});

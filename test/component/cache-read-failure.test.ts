import {spawnSync} from "child_process";
import path from "path";

test.each(["last-drain", "followers", "survivor", "short-read", "success", "split-last-drain"])(
    "real cache/socket ownership remains accurate (%s)", (mode) => {
        const result = spawnSync(process.execPath, ["-r", "ts-node/register/transpile-only",
            path.join(__dirname, "cache-read-failure-driver.ts"), mode], {
            cwd: path.resolve(__dirname, "../.."), encoding: "utf8", timeout: 25_000,
        });
        expect(result.error).toBeUndefined();
        expect({status: result.status, stderr: result.status === 0 ? "" : result.stderr}).toEqual({status: 0, stderr: ""});
        const line = result.stdout.split(/\r?\n/).find((value) => value.startsWith("RESULT "));
        expect(line).toBeDefined();
        const report = JSON.parse(line!.slice(7));
        if(mode === "last-drain") expect(report.drains).toEqual([false]);
        if(mode === "survivor") {
            expect(report.survivorBytes).toBe(8192);
            expect(report.globalBytes).toBe(report.survivorBytes);
            expect(report.survivorLive).toBe(true);
        }
        const successful = mode === "success";
        // #248 — 앞 데이터가 조각 두 개면 첫 조각만 나가고, 완료 콜백이 달린 뒤 조각은 깨진 캐시에 남는다.
        // 그 버퍼 전체가 오류와 함께 한 번만 실패로 알려진다.
        const split = mode === "split-last-drain";
        expect(report.writes.map((write: any) => [write.label, write.success])).toEqual([
            ["prefix", !split], ["current", successful],
            ...(mode === "followers" || successful ? [["follower", successful]] : []),
        ]);
        if(!successful) expect(report.writes[1].error).toBe(true);
        if(split) expect(report.writes[0].error).toBe(true);
        expect(report.drains).toEqual([successful]);
        const sentPrefix = split ? report.pieceBytes : report.prefixBytes;
        expect(report.sendLength).toBe(sentPrefix + (successful ? 4096 + 6144 : 0));
        expect(report.globalBytes).toBe(mode === "survivor" ? report.survivorBytes : 0);
        expect(report.pending).toBe(0);
        expect(report.cacheBytes).toBe(0);
        expect(report.ended).toBe(!successful);
        expect(report.ownerRetained).toBe(successful);
        // #258 AC-1 — 넘친 기록을 모두 보낸 열린 핸들러의 캐시 파일은 0 이다.
        if(successful) expect(report.cacheFileSize).toBe(0);
        expect(report.payloadValid).toBe(true);
    }, 30_000);

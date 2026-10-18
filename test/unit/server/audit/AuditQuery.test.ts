import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {AuditCursor, AuditQuery} from "../../../../src/server/audit/AuditQuery";
import {AuditEvent} from "../../../../src/server/audit/AuditSink";
import LoggerFactory from "../../../../src/util/logger/LoggerFactory";

// U4-02 / #110 — 3일치 파일(9/9 3줄, 9/10 4줄, 9/11 5줄)을 직접 쓰고 조회 규칙을 확인한다.
// 파일 안 줄 번호 i 기준으로 actor·type·outcome·target 을 교대한다. 그래서 9/11 의 group_created 는 i=1·3,
// 최신순(뒤집힌) 인덱스로는 3·1 이다.

const DAYS: Array<{date: string; count: number}> = [
    {date: "2026-09-09", count: 3},
    {date: "2026-09-10", count: 4},
    {date: "2026-09-11", count: 5},
];

const dayStart = (date: string): number => Date.parse(`${date}T00:00:00.000Z`);
const atOf = (date: string, i: number): number => dayStart(date) + (i + 1) * 3_600_000;
const fileOf = (date: string): string => `audit-${date}.jsonl`;

const eventOf = (date: string, i: number): AuditEvent => ({
    at: atOf(date, i),
    actor: {userId: i % 2 === 0 ? "u_a" : "u_b", username: i % 2 === 0 ? "a" : "b", role: "regular"},
    type: i % 2 === 0 ? "user_created" : "group_created",
    target: i % 2 === 0 ? {kind: "group", id: "g_1"} : {kind: "user", id: "u_b"},
    outcome: i % 2 === 0 ? "success" : "failure",
    summary: `${date}#${i}`,
});

const lineOf = (event: AuditEvent): string => `${JSON.stringify(event)}\n`;

const summaries = (events: AuditEvent[]): string[] => events.map((event) => event.summary);

// #177: 커서의 offset 은 파일 끝에서부터 소비한 바이트 수, total 은 커서를 만들 때의 파일 크기다.
const bytesOf = (date: string, indexes: number[]): number =>
    indexes.reduce((sum, i) => sum + Buffer.byteLength(lineOf(eventOf(date, i))), 0);
const sizeOf = (date: string, count: number): number => bytesOf(date, [...Array(count).keys()]);

describe("AuditQuery", () => {
    let dir: string;
    let query: AuditQuery;

    const writeDay = (date: string, count: number, extra: (i: number) => string = () => ""): void => {
        let content = "";
        for(let i = 0; i < count; i++) content += extra(i) + lineOf(eventOf(date, i));
        fs.writeFileSync(path.join(dir, fileOf(date)), content, "utf8");
    };

    beforeEach(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), "audit-query-"));
        for(const day of DAYS) writeDay(day.date, day.count);
        query = new AuditQuery(dir);
    });

    afterEach(() => {
        fs.rmSync(dir, {recursive: true, force: true});
    });

    it("필터 없이 limit 500 이면 12건이 at 내림차순이고 nextCursor 가 없다", async () => {
        const page = await query.query({limit: 500});
        expect(page.events).toHaveLength(12);
        const ats = page.events.map((event) => event.at);
        expect(ats).toEqual([...ats].sort((a, b) => b - a));
        expect(page.events[0].summary).toBe("2026-09-11#4");
        expect(page.events[11].summary).toBe("2026-09-09#0");
        expect(page).not.toHaveProperty("nextCursor");
    });

    it("limit 5 로 세 페이지를 넘기면 커서가 파일 경계를 넘고 합집합이 12건이며 중복이 없다", async () => {
        const first = await query.query({limit: 5});
        expect(summaries(first.events)).toEqual(["2026-09-11#4", "2026-09-11#3", "2026-09-11#2", "2026-09-11#1", "2026-09-11#0"]);
        expect(first.nextCursor).toBe(AuditQuery.encodeCursor({file: fileOf("2026-09-11"), offset: sizeOf("2026-09-11", 5), total: sizeOf("2026-09-11", 5)}));

        const second = await query.query({limit: 5, cursor: first.nextCursor});
        expect(summaries(second.events)).toEqual(["2026-09-10#3", "2026-09-10#2", "2026-09-10#1", "2026-09-10#0", "2026-09-09#2"]);
        expect(second.nextCursor).toBe(AuditQuery.encodeCursor({file: fileOf("2026-09-09"), offset: bytesOf("2026-09-09", [2]), total: sizeOf("2026-09-09", 3)}));

        const third = await query.query({limit: 5, cursor: second.nextCursor});
        expect(summaries(third.events)).toEqual(["2026-09-09#1", "2026-09-09#0"]);
        expect(third).not.toHaveProperty("nextCursor");

        const all = [...first.events, ...second.events, ...third.events].map((event) => event.summary);
        expect(all).toHaveLength(12);
        expect(new Set(all).size).toBe(12);
    });

    it("페이지 사이에 오늘 파일이 append 되어도 이미 본 이벤트를 다시 내지 않고 새 이벤트도 섞지 않는다", async () => {
        const first = await query.query({limit: 2});
        expect(summaries(first.events)).toEqual(["2026-09-11#4", "2026-09-11#3"]);
        expect(first.nextCursor).toBe(AuditQuery.encodeCursor({file: fileOf("2026-09-11"), offset: bytesOf("2026-09-11", [4, 3]), total: sizeOf("2026-09-11", 5)}));

        fs.appendFileSync(path.join(dir, fileOf("2026-09-11")), lineOf(eventOf("2026-09-11", 5)) + lineOf(eventOf("2026-09-11", 6)));

        const second = await query.query({limit: 2, cursor: first.nextCursor});
        expect(summaries(second.events)).toEqual(["2026-09-11#2", "2026-09-11#1"]);
        expect(AuditQuery.decodeCursor(second.nextCursor!)).toEqual({file: fileOf("2026-09-11"), offset: bytesOf("2026-09-11", [6, 5, 4, 3, 2, 1]), total: sizeOf("2026-09-11", 7)});

        const rest = await query.query({limit: 500, cursor: second.nextCursor});
        const seen = [...first.events, ...second.events, ...rest.events].map((event) => event.summary);
        expect(seen).not.toContain("2026-09-11#5");
        expect(seen).not.toContain("2026-09-11#6");
        expect(seen).toHaveLength(12);
        expect(new Set(seen).size).toBe(12);
    });

    it("파일이 커서를 만들 때보다 짧아지면 그 파일의 처음부터 다시 읽는다", async () => {
        // 보정 없이 쓰면 total - offset 위치(파일 중간)부터 읽어 엉뚱한 줄이 먼저 나온다.
        const size = sizeOf("2026-09-11", 5);
        const cursor = AuditQuery.encodeCursor({file: fileOf("2026-09-11"), offset: 100, total: size + 50});
        const page = await query.query({limit: 2, cursor});
        expect(summaries(page.events)).toEqual(["2026-09-11#4", "2026-09-11#3"]);
    });

    it("userId 필터는 actor.userId 완전 일치다", async () => {
        const page = await query.query({limit: 500, userId: "u_a"});
        expect(page.events).toHaveLength(7);
        expect(page.events.every((event) => event.actor.userId === "u_a")).toBe(true);
        expect((await query.query({limit: 500, userId: "u_"})).events).toEqual([]);
    });

    it("type 과 outcome 을 함께 주면 둘 다 만족하는 건만 나온다", async () => {
        const page = await query.query({limit: 500, type: "group_created", outcome: "failure"});
        expect(page.events).toHaveLength(5);
        expect(page.events.every((event) => event.type === "group_created" && event.outcome === "failure")).toBe(true);
        expect((await query.query({limit: 500, type: "group_created", outcome: "success"})).events).toEqual([]);
    });

    it("nextCursor.offset 은 필터 통과 건수가 아니라 소비한 바이트 수다", async () => {
        const page = await query.query({limit: 2, type: "group_created"});
        expect(summaries(page.events)).toEqual(["2026-09-11#3", "2026-09-11#1"]);
        expect(AuditQuery.decodeCursor(page.nextCursor!)).toEqual({file: fileOf("2026-09-11"), offset: bytesOf("2026-09-11", [4, 3, 2, 1]), total: sizeOf("2026-09-11", 5)});

        const next = await query.query({limit: 2, type: "group_created", cursor: page.nextCursor});
        expect(summaries(next.events)).toEqual(["2026-09-10#3", "2026-09-10#1"]);
    });

    it("from·to 는 닫힌 구간이다", async () => {
        const from = dayStart("2026-09-10");
        const to = Date.parse("2026-09-10T23:59:59.999Z");
        const day = await query.query({limit: 500, from, to});
        expect(summaries(day.events)).toEqual(["2026-09-10#3", "2026-09-10#2", "2026-09-10#1", "2026-09-10#0"]);

        const fromSecond = await query.query({limit: 500, from: atOf("2026-09-10", 1), to});
        expect(summaries(fromSecond.events)).toEqual(["2026-09-10#3", "2026-09-10#2", "2026-09-10#1"]);

        const exact = await query.query({limit: 500, from: atOf("2026-09-10", 2), to: atOf("2026-09-10", 2)});
        expect(summaries(exact.events)).toEqual(["2026-09-10#2"]);
    });

    it("기간 밖 날짜의 파일은 열지 않는다", async () => {
        // 기간 밖 파일을 디렉터리로 바꿔 두면, 그 파일을 열려고 할 때 읽기가 실패한다.
        fs.rmSync(path.join(dir, fileOf("2026-09-11")));
        fs.mkdirSync(path.join(dir, fileOf("2026-09-11")));
        fs.rmSync(path.join(dir, fileOf("2026-09-09")));
        fs.mkdirSync(path.join(dir, fileOf("2026-09-09")));
        const page = await query.query({limit: 500, from: dayStart("2026-09-10"), to: Date.parse("2026-09-10T23:59:59.999Z")});
        expect(page.events).toHaveLength(4);
    });

    it("targetKind·targetId 로 대상을 거른다", async () => {
        const page = await query.query({limit: 500, targetKind: "group", targetId: "g_1"});
        expect(page.events).toHaveLength(7);
        expect(page.events.every((event) => event.target?.kind === "group" && event.target?.id === "g_1")).toBe(true);
        expect((await query.query({limit: 500, targetKind: "user"})).events).toHaveLength(5);
        expect((await query.query({limit: 500, targetKind: "tunnel", targetId: "g_1"})).events).toEqual([]);
        const byId = await query.query({limit: 500, targetId: "u_b"});
        expect(byId.events).toHaveLength(5);
        expect(byId.events.every((event) => event.target?.id === "u_b")).toBe(true);
        expect((await query.query({limit: 500, targetKind: "group", targetId: "u_b"})).events).toEqual([]);
    });

    it("손상된 줄은 파일당 경고 1회만 남긴다", async () => {
        const warn = jest.spyOn(LoggerFactory.getLogger("server", "AuditQuery"), "warn").mockImplementation(() => undefined);
        try {
            writeDay("2026-09-10", 4, (i) => (i === 1 ? "not json\n" : i === 3 ? "[1,2]\n" : ""));
            writeDay("2026-09-09", 3, (i) => (i === 0 ? "{\n" : ""));
            expect((await query.query({limit: 500})).events).toHaveLength(12);
            const messages = warn.mock.calls.map((call) => String(call[0]));
            expect(messages.filter((message) => message.includes(fileOf("2026-09-10")))).toHaveLength(1);
            expect(messages.filter((message) => message.includes(fileOf("2026-09-09")))).toHaveLength(1);
            expect(messages.filter((message) => message.includes(fileOf("2026-09-11")))).toHaveLength(0);
        } finally {
            warn.mockRestore();
        }
    });

    it("at·type·outcome 중 하나라도 없는 줄은 손상으로 본다", async () => {
        const {at: _at, ...noAt} = eventOf("2026-09-10", 9);
        const {type: _type, ...noType} = eventOf("2026-09-10", 9);
        const {outcome: _outcome, ...noOutcome} = eventOf("2026-09-10", 9);
        writeDay("2026-09-10", 4, (i) => (i === 2 ? [noAt, noType, noOutcome].map((value) => JSON.stringify(value)).join("\n") + "\n" : ""));
        const page = await query.query({limit: 500});
        expect(page.events).toHaveLength(12);
        expect(summaries(page.events)).not.toContain("2026-09-10#9");
    });

    it("읽을 수 없는 감사 파일은 건너뛰고 나머지를 돌려준다", async () => {
        const warn = jest.spyOn(LoggerFactory.getLogger("server", "AuditQuery"), "warn").mockImplementation(() => undefined);
        try {
            fs.rmSync(path.join(dir, fileOf("2026-09-10")));
            fs.mkdirSync(path.join(dir, fileOf("2026-09-10")));
            const page = await query.query({limit: 500});
            expect(summaries(page.events)).toEqual(["2026-09-11#4", "2026-09-11#3", "2026-09-11#2", "2026-09-11#1", "2026-09-11#0",
                "2026-09-09#2", "2026-09-09#1", "2026-09-09#0"]);
            expect(warn.mock.calls.some((call) => String(call[0]).includes(fileOf("2026-09-10")))).toBe(true);
        } finally {
            warn.mockRestore();
        }
    });

    it("손상된 줄은 건너뛰고 나머지를 정상으로 돌려준다", async () => {
        writeDay("2026-09-10", 4, (i) => (i === 2 ? "not json\n{\"at\": 1}\n" : ""));
        const page = await query.query({limit: 500});
        expect(page.events).toHaveLength(12);
        const day = await query.query({limit: 500, from: dayStart("2026-09-10"), to: Date.parse("2026-09-10T23:59:59.999Z")});
        expect(summaries(day.events)).toEqual(["2026-09-10#3", "2026-09-10#2", "2026-09-10#1", "2026-09-10#0"]);
    });

    it("커서의 파일이 지워졌으면 그보다 오래된 파일부터 이어 간다", async () => {
        const cursor = AuditQuery.encodeCursor({file: fileOf("2026-09-10"), offset: 2, total: 4});
        fs.rmSync(path.join(dir, fileOf("2026-09-10")));
        const page = await query.query({limit: 500, cursor});
        expect(summaries(page.events)).toEqual(["2026-09-09#2", "2026-09-09#1", "2026-09-09#0"]);
        expect(page).not.toHaveProperty("nextCursor");
    });

    it("decodeCursor 는 모든 검사를 통과할 때만 값을 돌려준다", () => {
        const encodeRaw = (value: unknown): string => Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
        const valid: AuditCursor = {file: fileOf("2026-09-10"), offset: 2, total: 4};
        expect(AuditQuery.decodeCursor(AuditQuery.encodeCursor(valid))).toEqual(valid);
        expect(AuditQuery.encodeCursor(valid)).toBe(encodeRaw({v: 2, ...valid}));
        // #177: 줄 단위였던 옛 커서(버전 없음)는 받지 않는다.
        expect(AuditQuery.decodeCursor(encodeRaw(valid))).toBeUndefined();
        expect(AuditQuery.decodeCursor(encodeRaw({v: 1, ...valid}))).toBeUndefined();
        expect(AuditQuery.decodeCursor("***")).toBeUndefined();
        expect(AuditQuery.decodeCursor("")).toBeUndefined();
        expect(AuditQuery.decodeCursor(Buffer.from("not json").toString("base64url"))).toBeUndefined();
        expect(AuditQuery.decodeCursor(encodeRaw(null))).toBeUndefined();
        expect(AuditQuery.decodeCursor(encodeRaw({v: 2, file: fileOf("2026-09-10"), offset: 2}))).toBeUndefined();
        expect(AuditQuery.decodeCursor(encodeRaw({v: 2, file: "evil.jsonl", offset: 0, total: 0}))).toBeUndefined();
        expect(AuditQuery.decodeCursor(encodeRaw({v: 2, file: "../audit-2026-09-10.jsonl", offset: 0, total: 0}))).toBeUndefined();
        expect(AuditQuery.decodeCursor(encodeRaw({v: 2, file: fileOf("2026-09-10"), offset: -1, total: 4}))).toBeUndefined();
        expect(AuditQuery.decodeCursor(encodeRaw({v: 2, file: fileOf("2026-09-10"), offset: 1.5, total: 4}))).toBeUndefined();
        expect(AuditQuery.decodeCursor(encodeRaw({v: 2, file: fileOf("2026-09-10"), offset: 1, total: 4.5}))).toBeUndefined();
        expect(AuditQuery.decodeCursor(encodeRaw({v: 2, file: fileOf("2026-09-10"), offset: "1", total: 4}))).toBeUndefined();
        expect(AuditQuery.decodeCursor(encodeRaw({v: 2, file: fileOf("2026-09-10"), offset: 5, total: 4}))).toBeUndefined();
    });

    // #148 — 본인 이벤트가 적은 사용자의 조회가 매번 보존 기간 전체를 훑지 않게, 한 번에 훑는 줄 수에 상한을 둔다.
    it("훑은 줄이 상한에 닿으면 채우지 못했어도 커서를 돌려주고, 커서로 이어 가면 끝까지 간다", async () => {
        const capped = new AuditQuery(dir, {maxScanLines: 5});
        const first = await capped.query({limit: 500, userId: "nobody"});
        expect(first.events).toEqual([]);
        expect(first.nextCursor).toBeDefined();
        let cursor = first.nextCursor;
        let pages = 1;
        while(cursor !== undefined && pages < 20) {
            const page = await capped.query({limit: 500, userId: "nobody", cursor});
            cursor = page.nextCursor;
            pages++;
        }
        expect(cursor).toBeUndefined();
        expect(pages).toBeGreaterThan(2);
        // 상한 안에서 limit 을 채우면 지금처럼 그 자리에서 끝난다.
        const filled = await capped.query({limit: 3});
        expect(filled.events).toHaveLength(3);
    });

    it("디렉터리가 없으면 빈 결과다", async () => {
        const missing = new AuditQuery(path.join(dir, "missing"));
        const page = await missing.query({limit: 10});
        expect(page.events).toEqual([]);
        expect(page).not.toHaveProperty("nextCursor");
    });

    it("감사 파일 이름 규칙에 맞지 않는 파일은 읽지 않는다", async () => {
        fs.writeFileSync(path.join(dir, "audit-2026-09-12.jsonl.tmp"), lineOf(eventOf("2026-09-12", 0)));
        fs.writeFileSync(path.join(dir, "notes.jsonl"), lineOf(eventOf("2026-09-12", 1)));
        const page = await query.query({limit: 500});
        expect(page.events).toHaveLength(12);
    });

    // #177 — 하루 파일 전체를 메모리로 읽지 않는다. 끝에서부터 필요한 만큼만 읽고, 한 요청이 읽는 바이트에 상한을 둔다.
    describe("streaming from the end of the file (#177)", () => {
        const writeBig = (date: string, count: number): void => {
            const fd = fs.openSync(path.join(dir, fileOf(date)), "w");
            try {
                let chunk = "";
                for(let i = 0; i < count; i++) {
                    chunk += lineOf({...eventOf(date, i), summary: `${date}#${i}`, detail: {pad: "x".repeat(200)}} as AuditEvent);
                    if(chunk.length > 1 << 20) { fs.writeSync(fd, chunk); chunk = ""; }
                }
                fs.writeSync(fd, chunk);
            } finally { fs.closeSync(fd); }
        };

        it("a newest-first page of a large file reads only the tail", async () => {
            writeBig("2026-09-12", 100_000);
            const size = fs.statSync(path.join(dir, fileOf("2026-09-12"))).size;
            expect(size).toBeGreaterThan(20 * 1024 * 1024);
            const page = await query.query({limit: 3});
            expect(summaries(page.events)).toEqual(["2026-09-12#99999", "2026-09-12#99998", "2026-09-12#99997"]);
            expect(query.lastQueryBytesRead).toBeLessThan(1024 * 1024);
            const next = await query.query({limit: 2, cursor: page.nextCursor});
            expect(summaries(next.events)).toEqual(["2026-09-12#99996", "2026-09-12#99995"]);
            expect(query.lastQueryBytesRead).toBeLessThan(1024 * 1024);
        });

        it("stops at the byte cap with a cursor and continues to the end", async () => {
            const capped = new AuditQuery(dir, {maxScanBytes: 600});
            const first = await capped.query({limit: 500, userId: "nobody"});
            expect(first.events).toEqual([]);
            expect(first.nextCursor).toBeDefined();
            expect(capped.lastQueryBytesRead).toBeLessThanOrEqual(600 + 64 * 1024);
            let cursor = first.nextCursor;
            let pages = 1;
            while(cursor !== undefined && pages < 50) {
                cursor = (await capped.query({limit: 500, userId: "nobody", cursor})).nextCursor;
                pages++;
            }
            expect(cursor).toBeUndefined();
            expect(pages).toBeGreaterThan(2);
            // 한 줄이 상한보다 길어도 한 줄씩은 나아간다.
            const tiny = new AuditQuery(dir, {maxScanBytes: 1});
            const one = await tiny.query({limit: 500});
            expect(one.events).toHaveLength(1);
        });

        it("reads CRLF line endings and a last line without a newline", async () => {
            const lines = [0, 1, 2].map((i) => JSON.stringify(eventOf("2026-09-13", i)));
            fs.writeFileSync(path.join(dir, fileOf("2026-09-13")), `${lines[0]}\r\n${lines[1]}\r\n${lines[2]}`, "utf8");
            const page = await query.query({limit: 3});
            expect(summaries(page.events)).toEqual(["2026-09-13#2", "2026-09-13#1", "2026-09-13#0"]);
        });

        it("keeps multi-byte UTF-8 characters intact across read chunks", async () => {
            const name = "감사".repeat(40_000);
            fs.writeFileSync(path.join(dir, fileOf("2026-09-14")), lineOf({...eventOf("2026-09-14", 0), summary: name}), "utf8");
            const page = await query.query({limit: 1});
            expect(page.events[0].summary).toBe(name);
        });
    });

    // #177 리뷰 — 조각·줄 상한을 작게 두고 경계를 결정적으로 확인한다.
    describe("reverse reader boundaries (#177)", () => {
        const writeRaw = (date: string, content: string | Buffer) => fs.writeFileSync(path.join(dir, fileOf(date)), content);

        it("skips an oversized line and keeps the lines around it, also when it is the first line", async () => {
            const small = (i: number) => lineOf(eventOf("2026-09-15", i));
            const big = `${"z".repeat(500)}\n`;
            writeRaw("2026-09-15", big + small(0) + big + small(1));
            const warn = jest.spyOn(LoggerFactory.getLogger("server", "AuditQuery"), "warn").mockImplementation(() => undefined);
            try {
                const q = new AuditQuery(dir, {readChunkBytes: 16, maxLineBytes: 300});
                const page = await q.query({limit: 2});
                expect(summaries(page.events)).toEqual(["2026-09-15#1", "2026-09-15#0"]);
                const rest = await q.query({limit: 500, cursor: page.nextCursor, to: Date.parse("2026-09-15T23:59:59.999Z"), from: dayStart("2026-09-15")});
                expect(rest.events).toEqual([]);
                expect(warn).toHaveBeenCalled();
            } finally {
                warn.mockRestore();
            }
        });

        it("decodes a multi-byte character split across every possible chunk boundary", async () => {
            const event = {...eventOf("2026-09-16", 0), summary: "가나다라마바사"};
            writeRaw("2026-09-16", lineOf(event));
            for(let chunk = 1; chunk <= 12; chunk++) {
                const page = await new AuditQuery(dir, {readChunkBytes: chunk}).query({limit: 1});
                expect(page.events[0].summary).toBe("가나다라마바사");
            }
        });

        it("a file of blank lines stops at the byte cap instead of reading to the end", async () => {
            writeRaw("2026-09-17", "\n".repeat(200_000) + lineOf(eventOf("2026-09-17", 0)));
            const q = new AuditQuery(dir, {maxScanBytes: 1_000, readChunkBytes: 256});
            const first = await q.query({limit: 500, userId: "nobody"});
            expect(q.lastQueryBytesRead).toBeLessThan(5_000);
            expect(first.nextCursor).toBeDefined();
        });

        it("continues across blank lines with a cursor without losing or repeating events", async () => {
            const lines = [0, 1, 2, 3].map((i) => lineOf(eventOf("2026-09-18", i)));
            writeRaw("2026-09-18", `${lines[0]}\n\n${lines[1]}\n${lines[2]}\n\n\n${lines[3]}`);
            const q = new AuditQuery(dir, {readChunkBytes: 7});
            const seen: string[] = [];
            let cursor: string | undefined;
            do {
                const page = await q.query({limit: 1, cursor, from: dayStart("2026-09-18")});
                seen.push(...summaries(page.events));
                cursor = page.nextCursor;
            } while(cursor !== undefined);
            expect(seen).toEqual(["2026-09-18#3", "2026-09-18#2", "2026-09-18#1", "2026-09-18#0"]);
        });
    });
});

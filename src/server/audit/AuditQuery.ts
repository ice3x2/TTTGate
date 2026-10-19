import fs from "fs";
import Path from "path";
import LoggerFactory from "../../util/logger/LoggerFactory";
import type {AuditEvent, AuditTargetKind} from "./AuditSink";
import type {AuditEventType} from "./AuditEventTypes";
import {FileAuditSink} from "./FileAuditSink";

export type {AuditTargetKind} from "./AuditSink";

const logger = LoggerFactory.getLogger('server', 'AuditQuery');

const AUDIT_FILE_PATTERN = /^audit-\d{4}-\d{2}-\d{2}\.jsonl$/;

/** 한 번의 조회가 훑는 줄 수의 기본 상한. 일반 유저가 반복 조회로 보존 기간 전체를 매번 읽지 않게 한다(#148). */
const DEFAULT_MAX_SCAN_LINES = 50_000;
/** 한 번의 조회가 읽는 바이트의 기본 상한(#177). 줄 수 상한과 함께 걸린다. */
const DEFAULT_MAX_SCAN_BYTES = 16 * 1024 * 1024;
/** 파일 끝에서부터 한 번에 읽는 크기. */
const READ_CHUNK_BYTES = 64 * 1024;
/** 한 줄의 최대 길이. 넘는 줄은 손상으로 보고 건너뛴다(줄 하나가 메모리를 다 쓰지 않게). */
const MAX_LINE_BYTES = 4 * 1024 * 1024;

export type AuditFilter = {
    from?: number; to?: number;          // epoch ms, 닫힌 구간 [from, to]
    userId?: string;                     // actor.userId 완전 일치
    type?: AuditEventType;
    targetKind?: AuditTargetKind;
    targetId?: string;
    outcome?: 'success' | 'failure';
    limit: number;                       // 1..500
    cursor?: string;
};

export type AuditPage = {events: AuditEvent[]; nextCursor?: string};

/**
 * offset 은 그 파일 끝에서부터 소비한 바이트 수(필터 적용 전), total 은 커서를 만들 때 그 파일의 크기(바이트)다(#177).
 * 다음 조회는 total - offset 위치부터 앞쪽으로 읽는다. 그 사이 파일 뒤에 붙은 줄은 이 위치를 바꾸지 않는다.
 */
export type AuditCursor = {file: string; offset: number; total: number};

/** 커서 의미가 줄 수에서 바이트로 바뀐 판(#177). 옛 커서는 검증만 통과하고 엉뚱한 위치를 가리키므로 거부한다. */
const CURSOR_VERSION = 2;

const isNonNegativeInt = (value: unknown): value is number =>
    typeof value === 'number' && Number.isInteger(value) && value >= 0;

/**
 * U4-02 / #110 — #109 의 날짜별 JSONL 감사 파일을 최신순 커서 페이지로 읽는다.
 * 파일을 끝에서부터 조각(64KiB)씩 읽어 줄을 거꾸로 내므로, 메모리는 파일 크기가 아니라 조각과 한 줄 크기에 비례한다(#177).
 * 한 번의 조회는 줄 수와 바이트 수 상한 안에서만 읽고, 넘으면 채우지 못했어도 커서를 돌려준다. 파일에는 쓰지 않는다.
 */
export class AuditQuery {
    private readonly _dir: string;

    /** 한 번의 조회가 훑는 줄 수 상한. 넘으면 채우지 못했어도 커서를 돌려준다(#148). */
    private readonly _maxScanLines: number;
    private readonly _maxScanBytes: number;
    private readonly _read: ReadLimits;
    private _lastQueryBytesRead = 0;

    public constructor(dir: string, options: {maxScanLines?: number; maxScanBytes?: number; readChunkBytes?: number; maxLineBytes?: number} = {}) {
        // 0 이하면 같은 커서만 계속 돌려주므로 1 이상으로 둔다.
        this._maxScanLines = Math.max(1, Math.floor(options.maxScanLines ?? DEFAULT_MAX_SCAN_LINES));
        this._maxScanBytes = Math.max(1, Math.floor(options.maxScanBytes ?? DEFAULT_MAX_SCAN_BYTES));
        this._read = {
            chunkBytes: Math.max(1, Math.floor(options.readChunkBytes ?? READ_CHUNK_BYTES)),
            maxLineBytes: Math.max(1, Math.floor(options.maxLineBytes ?? MAX_LINE_BYTES))
        };
        this._dir = dir;
    }

    /**
     * 마지막 조회가 디스크에서 읽은 바이트 수. 조회 비용을 확인하는 진단값이다.
     * 인스턴스 하나를 여러 요청이 나눠 쓰므로 동시 조회에서는 다른 조회의 값일 수 있다.
     */
    public get lastQueryBytesRead(): number {
        return this._lastQueryBytesRead;
    }

    public static encodeCursor(cursor: AuditCursor): string {
        return Buffer.from(JSON.stringify({v: CURSOR_VERSION, ...cursor}), 'utf8').toString('base64url');
    }

    /** 커서 검사의 유일한 주체. 모든 검사를 통과할 때만 값을 돌려주고, 아니면 undefined 다(던지지 않는다). */
    public static decodeCursor(text: string): AuditCursor | undefined {
        if(typeof text !== 'string' || !/^[A-Za-z0-9_-]+$/.test(text)) return undefined;
        let parsed: unknown;
        try {
            parsed = JSON.parse(Buffer.from(text, 'base64url').toString('utf8'));
        } catch {
            return undefined;
        }
        if(typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return undefined;
        const {v, file, offset, total} = parsed as Record<string, unknown>;
        if(v !== CURSOR_VERSION) return undefined;
        if(typeof file !== 'string' || !AUDIT_FILE_PATTERN.test(file)) return undefined;
        if(!isNonNegativeInt(offset) || !isNonNegativeInt(total) || offset > total) return undefined;
        return {file, offset, total};
    }

    public async query(filter: AuditFilter): Promise<AuditPage> {
        const cursor = filter.cursor === undefined ? undefined : AuditQuery.decodeCursor(filter.cursor);
        const files = this.candidateFiles(filter, cursor);
        const events: AuditEvent[] = [];
        const budget = {lines: 0, bytes: 0};
        this._lastQueryBytesRead = 0;
        try {
            for(const file of files) {
                const handle = await this.open(file);
                if(handle === undefined) continue;
                try {
                    const stat = await handle.stat();
                    // 플랫폼에 따라 디렉터리도 열린다. 일반 파일이 아니면 읽을 수 없는 파일로 보고 건너뛴다.
                    if(!stat.isFile()) throw new Error('not a regular file');
                    const total = stat.size;
                    // 오늘 파일은 조회 사이에도 append 된다. 커서 위치(total - offset)는 그대로 쓰고, 파일이 줄었으면 끝에서 다시 시작한다.
                    const end = cursor && file === cursor.file && total >= cursor.total ? cursor.total - cursor.offset : total;
                    // 읽는 도중 오류가 나면 이미 담은 이벤트는 두고 다음 파일로 넘어간다(그 파일의 나머지는 이 조회에서 빠진다).
                    const page = await this.scanFile(handle, file, total, end, filter, events, budget);
                    if(page !== undefined) return page;
                } catch(error) {
                    logger.warn(`cannot read audit file ${file}: ${error instanceof Error ? error.message : String(error)}`);
                } finally {
                    await handle.close().catch(() => {});
                }
            }
            return {events};
        } finally {
            this._lastQueryBytesRead = budget.bytes;
        }
    }

    /** 한 파일을 end 위치부터 앞쪽으로 훑는다. 페이지를 채우거나 상한에 닿으면 커서가 든 페이지를 돌려준다. */
    private async scanFile(handle: fs.promises.FileHandle, file: string, total: number, end: number,
                           filter: AuditFilter, events: AuditEvent[], budget: {lines: number; bytes: number}): Promise<AuditPage | undefined> {
        let warned = false;
        const warn = () => {
            if(warned) return;
            warned = true;
            logger.warn(`skipping malformed audit line(s) in ${file}`);
        };
        const cursorAt = (position: number) => AuditQuery.encodeCursor({file, offset: total - position, total});
        let resume = end;
        for await (const entry of reverseLines(handle, end, budget, this._read)) {
            // 상한은 한 줄은 읽은 뒤에 본다. 한 줄이 상한보다 길어도 조회마다 한 줄씩은 나아간다.
            if(budget.lines > 0 && (budget.lines >= this._maxScanLines || budget.bytes > this._maxScanBytes)) {
                return {events, nextCursor: cursorAt(resume)};
            }
            // 빈 줄은 줄 수에 넣지 않지만 바이트 상한 판정은 받는다(빈 줄만 이어진 파일을 끝까지 읽지 않게).
            if(entry.blank) {
                resume = entry.start;
                continue;
            }
            budget.lines++;
            resume = entry.start;
            const event = entry.line === undefined ? undefined : parseEvent(entry.line);
            if(event === undefined) {
                warn();
                continue;
            }
            if(!matches(event, filter)) continue;
            events.push(event);
            if(events.length >= filter.limit) return {events, nextCursor: cursorAt(resume)};
        }
        return undefined;
    }

    /** 파일명 날짜 내림차순. 기간 밖과 커서보다 새로운 파일은 빼고, 커서의 파일이 없으면 그보다 오래된 파일부터 시작한다. */
    private candidateFiles(filter: AuditFilter, cursor: AuditCursor | undefined): string[] {
        if(!fs.existsSync(this._dir)) return [];
        const fromName = filter.from === undefined ? undefined : FileAuditSink.fileNameFor(filter.from);
        const toName = filter.to === undefined ? undefined : FileAuditSink.fileNameFor(filter.to);
        return fs.readdirSync(this._dir)
            .filter((name) => AUDIT_FILE_PATTERN.test(name))
            .filter((name) => (fromName === undefined || name >= fromName) && (toName === undefined || name <= toName))
            .filter((name) => cursor === undefined || name <= cursor.file)
            .sort()
            .reverse();
    }

    /** 목록을 만든 뒤 보존 정리가 파일을 지웠거나(ENOENT) 열 수 없으면 undefined 를 돌려주고 그 파일을 건너뛴다. */
    private async open(file: string): Promise<fs.promises.FileHandle | undefined> {
        try {
            return await fs.promises.open(Path.join(this._dir, file), 'r');
        } catch(error) {
            logger.warn(`cannot read audit file ${file}: ${error instanceof Error ? error.message : String(error)}`);
            return undefined;
        }
    }
}

type ReadLimits = {chunkBytes: number; maxLineBytes: number};

/**
 * [0, end) 구간의 줄을 끝에서부터 낸다. start 는 그 줄이 시작하는 바이트 위치다. 빈 줄은 blank 로 낸다.
 * 줄이 maxLineBytes 를 넘으면 내용 없이(line: undefined) 내고 건너뛴다. 읽은 바이트는 budget.bytes 에 더한다.
 * 조각 경계에서 UTF-8 문자가 잘리지 않도록 바이트로 모은 뒤 줄 단위로만 디코딩한다.
 * 줄 시작을 찾는 동안 조각은 배열에 모았다가 줄이 끝날 때 한 번만 잇는다(큰 줄에서 매 조각 전체를 복사하지 않게).
 */
async function* reverseLines(handle: fs.promises.FileHandle, end: number, budget: {bytes: number},
                             limits: ReadLimits): AsyncGenerator<{line?: string; start: number; blank?: true}> {
    let position = end;
    // 현재 줄의 뒤쪽 조각들(앞쪽 조각이 배열 앞에 온다). pendingBytes 는 그 합이다.
    let pending: Buffer[] = [];
    let pendingBytes = 0;
    let oversized = false;
    const take = (head: Buffer, start: number): {line?: string; start: number; blank?: true} => {
        const size = head.length + pendingBytes;
        const result = oversized || size > limits.maxLineBytes ? {start}
            : size === 0 ? {start, blank: true as const}
            : {line: decodeLine(pending.length > 0 ? Buffer.concat([head, ...pending]) : head), start};
        pending = [];
        pendingBytes = 0;
        oversized = false;
        return result;
    };
    while(position > 0) {
        const size = Math.min(limits.chunkBytes, position);
        position -= size;
        const chunk = Buffer.alloc(size);
        const {bytesRead} = await handle.read(chunk, 0, size, position);
        budget.bytes += bytesRead;
        let data = chunk.subarray(0, bytesRead);
        let newline: number;
        while((newline = data.lastIndexOf(0x0a)) !== -1) {
            const start = position + newline + 1;
            // 파일 끝의 개행 뒤는 줄이 아니다.
            if(!(start === end && pendingBytes === 0 && newline === data.length - 1)) yield take(data.subarray(newline + 1), start);
            data = data.subarray(0, newline);
        }
        if(oversized) continue;
        if(data.length + pendingBytes > limits.maxLineBytes) {
            // 아직 줄 시작을 못 찾았지만 이미 상한을 넘었다. 내용은 버리고 줄 시작까지 개행만 찾는다.
            oversized = true;
            pending = [];
            pendingBytes = 0;
        } else if(data.length > 0) {
            pending.unshift(Buffer.from(data));
            pendingBytes += data.length;
        }
    }
    if(oversized || pendingBytes > 0) yield take(Buffer.alloc(0), 0);
}

function decodeLine(bytes: Buffer): string {
    const text = bytes.toString('utf8');
    return text.endsWith('\r') ? text.slice(0, -1) : text;
}

function parseEvent(line: string): AuditEvent | undefined {
    let value: unknown;
    try {
        value = JSON.parse(line);
    } catch {
        return undefined;
    }
    if(typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
    const event = value as Partial<AuditEvent>;
    if(typeof event.at !== 'number' || typeof event.type !== 'string' || typeof event.outcome !== 'string') return undefined;
    return event as AuditEvent;
}

function matches(event: AuditEvent, filter: AuditFilter): boolean {
    if(filter.from !== undefined && event.at < filter.from) return false;
    if(filter.to !== undefined && event.at > filter.to) return false;
    if(filter.userId !== undefined && event.actor?.userId !== filter.userId) return false;
    if(filter.type !== undefined && event.type !== filter.type) return false;
    if(filter.outcome !== undefined && event.outcome !== filter.outcome) return false;
    if(filter.targetKind !== undefined && event.target?.kind !== filter.targetKind) return false;
    if(filter.targetId !== undefined && event.target?.id !== filter.targetId) return false;
    return true;
}

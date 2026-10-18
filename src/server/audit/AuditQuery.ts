import fs from "fs";
import Path from "path";
import readline from "readline";
import LoggerFactory from "../../util/logger/LoggerFactory";
import type {AuditEvent, AuditTargetKind} from "./AuditSink";
import type {AuditEventType} from "./AuditEventTypes";
import {FileAuditSink} from "./FileAuditSink";

export type {AuditTargetKind} from "./AuditSink";

const logger = LoggerFactory.getLogger('server', 'AuditQuery');

const AUDIT_FILE_PATTERN = /^audit-\d{4}-\d{2}-\d{2}\.jsonl$/;

/** 한 번의 조회가 훑는 줄 수의 기본 상한. 일반 유저가 반복 조회로 보존 기간 전체를 매번 읽지 않게 한다(#148). */
const DEFAULT_MAX_SCAN_LINES = 50_000;

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

/** offset 은 그 파일의 최신순(뒤집힌) 0 기반 라인 인덱스(필터 적용 전), total 은 커서를 만들 때 그 파일의 전체 라인 수. */
export type AuditCursor = {file: string; offset: number; total: number};

const isNonNegativeInt = (value: unknown): value is number =>
    typeof value === 'number' && Number.isInteger(value) && value >= 0;

/**
 * U4-02 / #110 — #109 의 날짜별 JSONL 감사 파일을 최신순 커서 페이지로 읽는다.
 * 한 번에 하루 파일 하나만 메모리에 올리고, 다음 파일로 넘어가기 전에 앞 파일의 배열을 버린다. 파일에는 쓰지 않는다.
 */
export class AuditQuery {
    private readonly _dir: string;

    /** 한 번의 조회가 훑는 줄 수 상한. 넘으면 채우지 못했어도 커서를 돌려준다(#148). */
    private readonly _maxScanLines: number;

    public constructor(dir: string, options: {maxScanLines?: number} = {}) {
        // 0 이하면 같은 커서만 계속 돌려주므로 1 이상으로 둔다.
        this._maxScanLines = Math.max(1, Math.floor(options.maxScanLines ?? DEFAULT_MAX_SCAN_LINES));
        this._dir = dir;
    }

    public static encodeCursor(cursor: AuditCursor): string {
        return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
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
        const {file, offset, total} = parsed as Record<string, unknown>;
        if(typeof file !== 'string' || !AUDIT_FILE_PATTERN.test(file)) return undefined;
        if(!isNonNegativeInt(offset) || !isNonNegativeInt(total) || offset > total) return undefined;
        return {file, offset, total};
    }

    public async query(filter: AuditFilter): Promise<AuditPage> {
        const cursor = filter.cursor === undefined ? undefined : AuditQuery.decodeCursor(filter.cursor);
        const files = this.candidateFiles(filter, cursor);
        const events: AuditEvent[] = [];
        let scanned = 0;
        for(const file of files) {
            const lines = await this.readLines(file);
            if(lines === undefined) continue;
            lines.reverse();
            const total = lines.length;
            let index = 0;
            if(cursor && file === cursor.file) {
                // 오늘 파일은 조회 사이에도 append 되므로 늘어난 줄 수만큼 뒤집힌 인덱스를 민다. 줄어들었으면 처음부터.
                index = total < cursor.total ? 0 : cursor.offset + (total - cursor.total);
            }
            let warned = false;
            for(; index < total; index++) {
                if(scanned >= this._maxScanLines) {
                    return {events, nextCursor: AuditQuery.encodeCursor({file, offset: index, total})};
                }
                scanned++;
                const event = parseEvent(lines[index]);
                if(event === undefined) {
                    if(!warned) {
                        warned = true;
                        logger.warn(`skipping malformed audit line(s) in ${file}`);
                    }
                    continue;
                }
                if(!matches(event, filter)) continue;
                events.push(event);
                if(events.length >= filter.limit) {
                    return {events, nextCursor: AuditQuery.encodeCursor({file, offset: index + 1, total})};
                }
            }
        }
        return {events};
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

    /**
     * 하루 파일을 라인 배열로 읽는다. 목록을 만든 뒤 보존 정리가 파일을 지웠거나(ENOENT) 읽을 수 없으면
     * undefined 를 돌려주고 그 파일을 건너뛴다. 스트림 오류가 프로세스 밖으로 새지 않도록 반복자 하나로만 읽는다.
     */
    private async readLines(file: string): Promise<string[] | undefined> {
        const input = fs.createReadStream(Path.join(this._dir, file), {encoding: 'utf8'});
        const reader = readline.createInterface({input, crlfDelay: Infinity});
        const lines: string[] = [];
        try {
            for await (const line of reader) lines.push(line);
            return lines;
        } catch(error) {
            logger.warn(`cannot read audit file ${file}: ${error instanceof Error ? error.message : String(error)}`);
            return undefined;
        } finally {
            reader.close();
            input.destroy();
        }
    }
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

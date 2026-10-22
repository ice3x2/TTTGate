import fs from "fs";
import Path from "path";
import Environment from "../../Environment";
import LoggerFactory from "../../util/logger/LoggerFactory";
import {redactSecrets} from "../../util/SecretRedactor";
import {AUDIT_EVENT_TYPES} from "./AuditEventTypes";
import type {AuditEvent, AuditSink} from "./AuditSink";

const logger = LoggerFactory.getLogger('server', 'FileAuditSink');

/** 감사 파일이 놓이는 디렉터리. 생성부(ServerApp)와 교체부(TTTServer)가 같은 경로를 쓰도록 한 곳에서만 만든다. */
export const auditDirPath = (): string => Path.join(Environment.path.logDir, 'audit');

const DAY_MS = 86_400_000;
const AUDIT_FILE_PATTERN = /^audit-(\d{4})-(\d{2})-(\d{2})\.jsonl$/;
const DIR_MODE = 0o700;
/** 쓰기 실패 뒤 재시도 간격. 실패가 이어지면 두 배씩 늘려 상한에서 멈춘다(즉시 재시도로 CPU 를 태우지 않는다). */
const RETRY_INITIAL_MS = 200;
const RETRY_MAX_MS = 30_000;
/** close() 가 남은 큐를 기다리는 상한. 디스크 오류가 이어져도 종료·싱크 교체가 멈추지 않게 한다. */
const DEFAULT_CLOSE_TIMEOUT_MS = 10_000;
const FILE_MODE = 0o600;

/**
 * 큐에 자리가 없다는 사실을 `record()` 의 reject 값으로 나르는 표식.
 * 분기는 `queue.length + reserved >= queueSize` 조건문이 내리므로 이 값을 throw 해서 잡지 않는다.
 */
export class AuditBackpressureError extends Error {
    public readonly code = 'audit_unavailable';

    public constructor() {
        super('audit queue is full');
        this.name = 'AuditBackpressureError';
    }
}

/** 테스트가 배압을 재현할 수 있도록 좁혀 둔 쓰기 스트림 경계. */
export type AuditWriteStream = Pick<fs.WriteStream, 'write' | 'once' | 'end' | 'on'>;

export type FileAuditSinkOptions = {
    dir: string;
    queueSize: number;
    /** 0 이면 무제한(PRD §12 Q3). 그 외에는 일 수. */
    retentionDays: number;
    openStream?: (path: string) => AuditWriteStream;
    closeTimeoutMs?: number;
};

type QueuedLine = {fileName: string; line: string};

/**
 * append-only 파일 감사 저장소.
 *
 * 불변식은 하나다: `queue.length + reserved <= queueSize`.
 * 쓰기 대기 중인 항목도 큐에 남겨 두므로 이 합이 "아직 디스크에 닿지 않은 이벤트 수" 를 정확히 센다.
 * Node 는 단일 스레드이므로 상태는 배열 하나·정수 하나·불리언 둘로 충분하고 잠금을 쓰지 않는다.
 */
export class FileAuditSink implements AuditSink {
    private readonly _dir: string;
    private readonly _queueSize: number;
    private readonly _retentionDays: number;
    private readonly _openStream: (path: string) => AuditWriteStream;
    private readonly _queue: QueuedLine[] = [];
    private readonly _flushWaiters: Array<() => void> = [];
    private _reserved = 0;
    private _draining = false;
    private _closed = false;
    private _dirReady = false;
    private _stream?: AuditWriteStream;
    private _streamFileName?: string;
    private _retentionTimer?: NodeJS.Timeout;
    private _retryTimer?: NodeJS.Timeout;
    private _retryDelayMs = 0;
    private readonly _closeTimeoutMs: number;

    public constructor(options: FileAuditSinkOptions) {
        this._dir = options.dir;
        this._queueSize = options.queueSize;
        this._retentionDays = options.retentionDays;
        this._closeTimeoutMs = options.closeTimeoutMs ?? DEFAULT_CLOSE_TIMEOUT_MS;
        this._openStream = options.openStream
            ?? ((path: string) => fs.createWriteStream(path, {flags: 'a', mode: FILE_MODE}));
    }

    public static fileNameFor(atMs: number): string {
        return `audit-${new Date(atMs).toISOString().slice(0, 10)}.jsonl`;
    }

    public get queueLength(): number {
        return this._queue.length;
    }

    public get reservedCount(): number {
        return this._reserved;
    }

    public get queueSize(): number {
        return this._queueSize;
    }

    public get retentionDays(): number {
        return this._retentionDays;
    }

    /** 기록할 칸 하나를 미리 잡는다. false 면 호출자는 작업을 실행하지 않는다(드롭 금지). */
    public reserve(): boolean {
        if(this._closed) return false;
        const pending = this._queue.length + this._reserved;
        if(pending >= this._queueSize) {
            logger.warn(`audit queue full (${pending})`);
            return false;
        }
        this._reserved += 1;
        return true;
    }

    public record(event: AuditEvent): Promise<void> {
        // 닫힌 뒤에도 잡아 둔 칸의 기록은 받는다. audited() 는 reserve() 시점의 싱크 참조를 들고
        // 핸들러가 끝난 뒤 그 참조에 기록하므로, 감사 옵션을 바꾸는 저장처럼 핸들러 안에서 싱크가
        // 갈아 끼워지면 선점한 칸이 남은 채로 닫힌다. 그 칸을 버리면 그 저장 사실이 어디에도 남지
        // 않는다(드롭 금지). 선점하지 않은 새 기록은 닫힌 싱크에서 계속 거부한다.
        if(this._closed && this._reserved === 0) return Promise.reject(new AuditBackpressureError());
        if(this._reserved > 0) {
            // 선점은 소유되지 않고 개수로만 센다 — 어느 호출자의 record() 든 잡아 둔 칸 하나를 쓴다.
            this._reserved -= 1;
        } else if(this._queue.length >= this._queueSize) {
            return Promise.reject(new AuditBackpressureError());
        }
        const prepared: AuditEvent = event.detail === undefined
            ? event : {...event, detail: redactSecrets(event.detail)};
        this._queue.push({fileName: FileAuditSink.fileNameFor(prepared.at), line: `${JSON.stringify(prepared)}\n`});
        if(!this._draining) {
            this._draining = true;
            setImmediate(() => this.drain());
        }
        return Promise.resolve();
    }

    /** 큐가 비고 마지막 write 의 콜백이 불릴 때까지 기다린다. */
    public flush(): Promise<void> {
        if(this._queue.length === 0 && !this._draining) return Promise.resolve();
        return new Promise<void>((resolve) => this._flushWaiters.push(resolve));
    }

    public startRetentionTimer(): void {
        this.pruneRetention();
        this._retentionTimer = setInterval(() => this.pruneRetention(), DAY_MS);
        this._retentionTimer.unref();
    }

    /**
     * 보존 기간이 지난 파일을 지우고 지운 파일명을 돌려준다.
     * 경계는 "파일 날짜의 다음날 00:00 UTC" 이므로 오늘 파일과 보존 기간 안의 파일은 시각과 무관하게 남는다.
     */
    public pruneRetention(now: number = Date.now()): string[] {
        if(this._retentionDays === 0) return [];
        if(!fs.existsSync(this._dir)) return [];
        const cutoff = now - this._retentionDays * DAY_MS;
        const removed: string[] = [];
        for(const name of fs.readdirSync(this._dir).sort()) {
            const matched = AUDIT_FILE_PATTERN.exec(name);
            if(matched === null) continue;
            const endOfDay = Date.UTC(Number(matched[1]), Number(matched[2]) - 1, Number(matched[3])) + DAY_MS;
            if(endOfDay > cutoff) continue;
            fs.unlinkSync(Path.join(this._dir, name));
            removed.push(name);
        }
        if(removed.length > 0) {
            this.record({
                at: now, actor: {userId: 'system'}, type: AUDIT_EVENT_TYPES.audit_retention_pruned,
                outcome: 'success', summary: `Pruned ${removed.length} audit files`,
                detail: {files: removed, retentionDays: this._retentionDays}
            }).catch(() => logger.warn(`audit retention prune event not recorded (queue full): ${removed.length} files`));
        }
        return removed;
    }

    public async close(): Promise<void> {
        if(this._retentionTimer !== undefined) {
            clearInterval(this._retentionTimer);
            this._retentionTimer = undefined;
        }
        let timer: NodeJS.Timeout | undefined;
        const timedOut = await Promise.race([
            this.flush().then(() => false),
            new Promise<boolean>((resolve) => { timer = setTimeout(() => resolve(true), this._closeTimeoutMs); })
        ]);
        clearTimeout(timer);
        if(timedOut) {
            logger.error(`audit sink closed with ${this._queue.length} events not written (write keeps failing)`);
        }
        if(this._retryTimer !== undefined) {
            clearTimeout(this._retryTimer);
            this._retryTimer = undefined;
        }
        this._closed = true;
        const stream = this._stream;
        this._stream = undefined;
        this._streamFileName = undefined;
        if(stream === undefined) return;
        await new Promise<void>((resolve) => stream.end(() => resolve()));
    }

    /**
     * 큐 앞의 항목을 꺼내지 않고 읽어 쓴다. write 의 콜백(그리고 배압이 걸렸으면 drain)이 온 뒤에야
     * shift 로 버린다 — 꺼낸 뒤 기다리면 쓰기 대기 항목이 회계에서 빠져 배압 경계가 무너진다.
     */
    private drain(): void {
        if(this._queue.length === 0) {
            this._draining = false;
            // 닫힌 뒤 선점 칸의 기록을 쓰려고 다시 연 스트림은 여기서 닫는다. 남겨 두면 fd 가 새고 교체된 싱크와 같은 파일에 쓴다.
            if(this._closed) this.discardStream();
            const waiters = this._flushWaiters.splice(0, this._flushWaiters.length);
            waiters.forEach((waiter) => waiter());
            return;
        }
        const item = this._queue[0];
        let stream: AuditWriteStream;
        try {
            stream = this.streamFor(item.fileName);
        } catch(error) {
            this.scheduleRetry(error);
            return;
        }
        let callbackDone = false;
        let failed = false;
        let drainPending = false;
        let advanced = false;
        let writeReturned = false;
        const advance = (): void => {
            if(advanced || !callbackDone || drainPending || !writeReturned) return;
            advanced = true;
            this._retryDelayMs = 0;
            this._queue.shift();
            this.drain();
        };
        // 콜백의 오류를 보지 않고 shift 하면 디스크 오류(ENOSPC·EACCES) 때 항목이 사라진다(#142).
        // 실패한 항목은 큐 앞에 남겨 두고 새 스트림으로 다시 쓴다. 일부가 이미 써졌다면 같은 줄이 두 번 남을 수
        // 있지만, 감사에서는 중복이 유실보다 낫다.
        const accepted = stream.write(item.line, (error?: Error | null) => {
            if(error) {
                if(!failed) { failed = true; this.scheduleRetry(error); }
                return;
            }
            callbackDone = true;
            advance();
        });
        writeReturned = true;
        if(!accepted) {
            drainPending = true;
            stream.once('drain', () => { drainPending = false; advance(); });
        }
        advance();
    }

    /** 스트림을 버리고 디렉터리 확인부터 다시 하도록 표시한 뒤, 백오프 간격 뒤에 drain 을 다시 부른다. */
    private discardStream(): void {
        const stream = this._stream;
        this._stream = undefined;
        this._streamFileName = undefined;
        if(stream !== undefined) {
            try { stream.end(); } catch { /* 이미 오류로 닫힌 스트림이다 */ }
        }
    }

    private scheduleRetry(reason: unknown): void {
        this._dirReady = false;
        this.discardStream();
        // close() 가 시간 초과로 끝난 뒤 늦게 온 실패다. 닫힌 싱크는 다시 시도하지 않는다(새 싱크가 같은 파일을 쓴다).
        if(this._closed) {
            this._draining = false;
            logger.error(`audit sink closed; ${this._queue.length} events not written`, reason);
            return;
        }
        if(this._retryTimer !== undefined) return;
        this._retryDelayMs = this._retryDelayMs === 0 ? RETRY_INITIAL_MS : Math.min(this._retryDelayMs * 2, RETRY_MAX_MS);
        logger.error(`audit write failed; retrying in ${this._retryDelayMs}ms (${this._queue.length} queued)`, reason);
        this._retryTimer = setTimeout(() => {
            this._retryTimer = undefined;
            this.drain();
        }, this._retryDelayMs);
        this._retryTimer.unref?.();
    }

    private streamFor(fileName: string): AuditWriteStream {
        if(this._stream !== undefined && this._streamFileName === fileName) return this._stream;
        if(this._stream !== undefined) this._stream.end();
        if(!this._dirReady) {
            fs.mkdirSync(this._dir, {recursive: true, mode: DIR_MODE});
            this._dirReady = true;
        }
        const stream = this._openStream(Path.join(this._dir, fileName));
        stream.on('error', (error: Error) => {
            logger.error(`audit stream error (${fileName})`, error);
            // 스트림만 버리고 큐는 남긴다. 다음 쓰기에서 디렉터리부터 다시 확인하고 같은 파일을 다시 연다.
            this._dirReady = false;
            if(this._stream === stream) {
                this._stream = undefined;
                this._streamFileName = undefined;
            }
        });
        this._stream = stream;
        this._streamFileName = fileName;
        return stream;
    }
}

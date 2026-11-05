import {AdmissionReason} from "./AdmissionPolicy";
import {DenialScope} from "./DenialTally";
import {DENIAL_LOG_WINDOW_MS} from "./DenialAggregator";
import {DenialWindows} from "./DenialWindows";
import {LogWriter} from "../../util/logger/LogWriter";

/** 한 창에 둘 수 있는 (IP, 범위, 사유) 키의 수. 넘는 거절은 IP 를 `*` 로 쓴 (범위, 사유) 키로 합친다. */
export const DENIAL_LOG_MAX_KEYS = 10_000;
export const DENIAL_LOG_SWEEP_INTERVAL_MS = 60 * 60_000;
const NAME = 'denial';

type FileWindow = {windowStart: number; last: number; count: number; ip: string; scope: DenialScope; reason: AdmissionReason};

export type DenialFileLogOptions = {
    dir: string;
    /** 줄을 쓸 때 국가를 찾는다. 모르거나 보이지 않을 때는 undefined. */
    countryOf: (ip: string) => string | undefined;
    maxKeys?: number;
    windowMs?: number;
};

/**
 * #327 REQ-7~15: 거절 로그 파일. SSH 로 서버에 들어가 읽는 용도이며, 관리 화면에는 보이지 않는다.
 * 같은 (IP, 범위, 사유)의 거절을 1분 창으로 묶어 `denial-YYYY.MM.DD.log` 에 비동기로 append 한다.
 * 보관 일수가 0 이하이면 아무것도 쓰지 않는다. 시각은 인자로 받는다 — 이 클래스는 시계를 읽지 않는다.
 */
export class DenialFileLog {
    private readonly _windows: DenialWindows<FileWindow>;
    private readonly _maxKeys: number;
    private _writer: LogWriter | undefined;
    private _lastSweep = 0;

    constructor(private readonly _options: DenialFileLogOptions) {
        this._windows = new DenialWindows(_options.windowMs ?? DENIAL_LOG_WINDOW_MS);
        this._maxKeys = _options.maxKeys ?? DENIAL_LOG_MAX_KEYS;
    }

    public get directory(): string {
        return this._options.dir;
    }

    public get enabled(): boolean {
        return this._writer !== undefined;
    }

    /**
     * 보관 일수를 정한다. 1 이상이면 쓰기를 켜고 기한이 지난 파일을 바로 지운다.
     * 0 이하이면 쓰기를 끄고 아직 쓰지 않은 묶음을 버린다. 이미 있는 파일은 지우지 않는다.
     */
    public configure(retentionDays: number, now: number = Date.now()): void {
        if (retentionDays <= 0) {
            this._windows.clear();
            this._writer?.end();
            this._writer = undefined;
            return;
        }
        // history 0: LogWriter 의 기본 삭제 규칙은 돌지 않는다. retentionDays 규칙만 돈다.
        this._writer ??= LogWriter.create({name: NAME, path: this._options.dir, history: 0, file: true, console: false, level: 'info'});
        this._writer.retentionDays = retentionDays;
        this.sweep(now);
    }

    public record(scope: DenialScope, ip: string, reason: AdmissionReason, now: number): void {
        if (!this._writer) return;
        if (this.bump(`${ip}|${scope}|${reason}`, now)) return;
        // 키가 너무 많으면 (범위, 사유)별 한 키로 합친다. 합친 키는 한도를 따지지 않는다(사유 다섯 × 범위 수만큼만 생긴다).
        const merged = this._windows.size >= this._maxKeys;
        const address = merged ? '*' : ip;
        const key = `${address}|${scope}|${reason}`;
        if (merged && this.bump(key, now)) return;
        this._windows.open(key, {windowStart: now, last: now, count: 1, ip: address, scope, reason});
    }

    /** 열린 창이 있으면 건수와 마지막 시각을 고치고 true 를 돌려준다. */
    private bump(key: string, now: number): boolean {
        const window = this._windows.find(key);
        if (!window) return false;
        window.count++;
        window.last = now;
        return true;
    }

    /** 창이 닫힌 묶음을 쓴다. 쓴 줄 수를 돌려준다. */
    public flushDue(now: number): number {
        const writer = this._writer;
        if (!writer) return 0;
        const due = this._windows.takeDue(now);
        for (const window of due) {
            writer.pushMessage({name: NAME, module: 'Denial', message: this.line(window), day: 0, level: 'info'});
        }
        return due.length;
    }

    /** 주기 타이머가 부른다. 닫힌 묶음을 쓰고, 한 시간마다 기한이 지난 파일을 지운다. */
    public tick(now: number): void {
        this.flushDue(now);
        if (this._writer && now - this._lastSweep >= DENIAL_LOG_SWEEP_INTERVAL_MS) this.sweep(now);
    }

    /**
     * 테스트 전용: 창이 닫히지 않은 묶음도 쓴 뒤 파일을 닫는다. 운영 코드는 부르지 않는다.
     * 서버에는 종료 처리기가 없어서, 멈추면 쓰지 않은 묶음은 잃는다(#327 REQ-8). 종료 경로에 붙이면 그 계약이 바뀐다.
     */
    public async closeForTest(): Promise<void> {
        const writer = this._writer;
        if (!writer) return;
        this.flushDue(Number.POSITIVE_INFINITY);
        this._writer = undefined;
        await writer.endAsync();
    }

    private sweep(now: number): void {
        this._lastSweep = now;
        this._writer?.sweepExpired();
    }

    private line(window: FileWindow): string {
        const country = window.ip === '*' ? undefined : this._options.countryOf(window.ip);
        return `first=${new Date(window.windowStart).toISOString()} last=${new Date(window.last).toISOString()} ip=${window.ip}`
            + ` country=${country ?? '-'} port=${window.scope} reason=${window.reason} count=${window.count}`;
    }
}

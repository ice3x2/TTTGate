import type {TunnelingStatus} from '../../controller/Options';

// 이슈 338 — 터널 상태 폴링. 목록과 편집 화면이 이 하나를 쓴다.
// - 시작하면 바로 읽고 주기마다 읽는다. 앞의 읽기가 끝나지 않았으면 그 회차는 건너뛴다.
// - 멈춘 읽기는 기한에 끊는다(휴대폰 망 전환으로 응답이 오지 않는 경우).
// - 상태를 바꾸기 직전에 invalidate 를 부르면 그 앞에 시작한 읽기의 결과를 버린다(낡은 결과가 바꾼 행을 되돌리지 않게).
// - 세션이 끝나면 멈춘다. 그 밖의 실패는 알리고 다음 회차에 다시 읽는다.

export type StatusSnapshot = {serverTime: number; statuses: TunnelingStatus[]};

export type StatusPollerOptions = {
    load: (signal: AbortSignal) => Promise<StatusSnapshot>;
    onSnapshot: (snapshot: StatusSnapshot) => void;
    onSessionOut: () => void;
    isSessionOut: (error: unknown) => boolean;
    onFailure?: () => void;
    /** 주기마다 부른다. 읽기가 멈춰 있어도 부른다(낡음 표시의 시계). */
    onTick?: (now: number) => void;
    intervalMs?: number;
    timeoutMs?: number;
    now?: () => number;
};

type Read = {controller: AbortController; done: Promise<void>};

export class StatusPoller {
    private readonly _options: StatusPollerOptions;
    private _timer: ReturnType<typeof setInterval> | undefined;
    private _current: Read | undefined;
    private _generation = 0;
    private _stopped = false;

    public constructor(options: StatusPollerOptions) {
        this._options = options;
    }

    public start(): void {
        if(this._timer !== undefined || this._stopped) return;
        void this.read();
        this._timer = setInterval(() => {
            this._options.onTick?.((this._options.now ?? Date.now)());
            void this.read();
        }, this._options.intervalMs ?? 1000);
    }

    public stop(): void {
        this._stopped = true;
        clearInterval(this._timer);
        this._timer = undefined;
        this._current?.controller.abort();
    }

    /** 상태를 바꾸는 요청 직전에 부른다. 그 앞에 시작한 읽기의 결과는 쓰지 않는다. */
    public invalidate(): void {
        this._generation++;
    }

    /** 진행 중인 읽기를 끊고 지금 새로 읽는다. 그 읽기가 끝나면 돌아온다. */
    public async refresh(): Promise<void> {
        if(this._stopped) return;
        this._current?.controller.abort();
        this._current = undefined;
        await this.read();
    }

    private read(): Promise<void> {
        if(this._stopped) return Promise.resolve();
        if(this._current) return this._current.done;
        const controller = new AbortController();
        const generation = this._generation;
        const timeout = setTimeout(() => controller.abort(), this._options.timeoutMs ?? 5000);
        const done = this.settle(controller, generation).finally(() => {
            clearTimeout(timeout);
            if(this._current?.controller === controller) this._current = undefined;
        });
        this._current = {controller, done};
        return done;
    }

    private async settle(controller: AbortController, generation: number): Promise<void> {
        let snapshot: StatusSnapshot;
        // fetch 는 실패를 예외로만 알린다(고를 수 없는 계약이다). 여기서 받아 실패 알림으로 바꾼다.
        try {
            snapshot = await this._options.load(controller.signal);
        } catch(error) {
            if(this._stopped) return;
            if(this._options.isSessionOut(error)) {
                this.stop();
                this._options.onSessionOut();
                return;
            }
            // refresh 가 끊은 읽기는 실패가 아니다. 기한으로 끊긴 읽기는 실패다.
            if(this._current?.controller === controller) this._options.onFailure?.();
            return;
        }
        if(this._stopped || generation !== this._generation) return;
        this._options.onSnapshot(snapshot);
    }
}

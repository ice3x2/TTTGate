import * as fs from "fs";
import * as Path from "path";
import LoggerFactory from "../util/logger/LoggerFactory";
import {ClientConnectionEvent} from "./TTTClient";

const logger = LoggerFactory.getLogger('client', 'ClientStatusFile');

/**
 * 클라이언트 연결 상태 파일(#322 REQ-15). 클라이언트가 쓰고 `TTTGate status` 가 읽는다.
 * 파일 형식은 이 모듈만 안다.
 */
const CLIENT_STATUS_FILE_NAME = ".status_client";

/**
 * 이보다 짧게 유지된 연결은 실패로 센다. 클라이언트는 인증 결과를 기다리지 않고 '연결됨'이 되고,
 * 서버는 인증에 실패한 연결을 이유 없이 닫기 때문이다(#322 REQ-2b).
 */
const STABLE_CONNECTION_MS = 30_000;

type ClientConnectionState = "connecting" | "connected" | "reconnecting";
const STATES: ReadonlyArray<ClientConnectionState> = ["connecting", "connected", "reconnecting"];

/** failures 는 안정되지 못하고 끝난 연속 연결 수다. */
type ClientConnectionStatus = {state: ClientConnectionState, since: number, failures: number, pid: number};

class ClientConnectionTracker {
    private _failures = 0;
    private _connectedAt: number | undefined;

    constructor(private readonly _now: () => number, private readonly _pid: number) {}

    public connecting(): ClientConnectionStatus {
        this._connectedAt = undefined;
        return this.status("connecting");
    }

    public connected(): ClientConnectionStatus {
        this._connectedAt = this._now();
        return this.status("connected");
    }

    public closed(): ClientConnectionStatus {
        const stable = this._connectedAt !== undefined && this._now() - this._connectedAt >= STABLE_CONNECTION_MS;
        this._failures = stable ? 0 : this._failures + 1;
        this._connectedAt = undefined;
        return this.status("reconnecting");
    }

    private status(state: ClientConnectionState): ClientConnectionStatus {
        return {state, since: this._now(), failures: this._failures, pid: this._pid};
    }
}

/** 상태를 쓴다. 읽는 쪽이 반쯤 쓴 파일을 보지 않도록 임시 파일에 쓰고 이름을 바꾼다. 실패해도 연결에는 영향을 주지 않는다. */
const writeClientStatus = (binDir: string, status: ClientConnectionStatus): void => {
    const file = Path.join(binDir, CLIENT_STATUS_FILE_NAME);
    const temp = `${file}.${status.pid}.tmp`;
    try {
        fs.writeFileSync(temp, JSON.stringify(status), {encoding: "utf-8"});
        fs.renameSync(temp, file);
    } catch (e) {
        logger.debug(`cannot write ${file}: ${(e as Error).message}`);
    }
};

const isStatus = (value: unknown): value is ClientConnectionStatus => {
    if(typeof value !== "object" || value === null) return false;
    const v = value as {[key: string]: unknown};
    return STATES.includes(v.state as ClientConnectionState) && Number.isFinite(v.since) && Number.isSafeInteger(v.failures)
        && Number.isSafeInteger(v.pid);
};

/** 파일이 없거나 형식이 맞지 않으면 undefined 다. */
const readClientStatus = (binDir: string): ClientConnectionStatus | undefined => {
    const file = Path.join(binDir, CLIENT_STATUS_FILE_NAME);
    if(!fs.existsSync(file)) return undefined;
    let text: string;
    try {
        text = fs.readFileSync(file, "utf-8");
    } catch {
        return undefined;
    }
    let parsed: unknown;
    try {
        parsed = JSON.parse(text);
    } catch {
        return undefined;
    }
    if(!isStatus(parsed)) return undefined;
    return {state: parsed.state, since: parsed.since, failures: parsed.failures, pid: parsed.pid};
};

/** 클라이언트의 연결 바뀜을 상태 파일에 적게 한다. */
const trackClientStatus = (client: {onConnectionEvent: ((event: ClientConnectionEvent) => void) | undefined}, binDir: string,
                           now: () => number = Date.now, pid: number = process.pid): void => {
    const tracker = new ClientConnectionTracker(now, pid);
    client.onConnectionEvent = (event) => {
        writeClientStatus(binDir, event === 'connecting' ? tracker.connecting() : event === 'connected' ? tracker.connected() : tracker.closed());
    };
};

export {trackClientStatus, CLIENT_STATUS_FILE_NAME, STABLE_CONNECTION_MS, ClientConnectionTracker, ClientConnectionStatus, ClientConnectionState,
    writeClientStatus, readClientStatus};

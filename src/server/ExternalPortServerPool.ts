import {TCPServer} from "../util/TCPServer";
import SocketState from "../util/SocketState";
import {SocketHandler} from "../util/SocketHandler";
import {TunnelingOption} from "../types/TunnelingOption";
import HttpHandler from "./http/HttpHandler";
import {CertInfo} from "./CertificationStore";
import ObjectUtil from "../util/ObjectUtil";
import {EndpointHandler, EndpointHttpHandler, EndPointInfo} from "../types/EndpointHandler";
import {clearInterval} from "timers";
import LoggerFactory  from "../util/logger/LoggerFactory";
import {AdmissionController} from "./security/AdmissionController";
import {BandwidthLimiter} from "./security/BandwidthLimiter";
import {computeWatermarkBytes, ResourcePolicyRegistry} from "../util/ResourcePolicy";
import {rateLimitBucketOf} from "./security/ConnectionRateLimiter";

// #124 (U5-09) 클라이언트→외부 대역폭 큐. 상한(limit)을 넘으면 세션을 닫고, 상단 워터마크에서 터널 소스를 멈춘다.
type SendQueue = {chunks: Buffer[]; bytes: number; limit: number; timer: NodeJS.Timeout | null; reliefListeners: Array<() => void>};
const logger = LoggerFactory.getLogger('server', 'ExternalPortServerPool');
/** setTimeout 이 받는 최대 지연(2^31-1ms). 넘기면 Node 가 1ms 로 바꾼다. */
const MAX_TIMER_DELAY_MS = 2_147_483_647;

// U5-02 / #117 — concurrency-limit 거절을 http/https에서만 명시 응답으로 되돌려준다(#123 (U5-08) 전까지는 발생하지 않는다).
const HTTP_503 = Buffer.from('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
/**
 * 외부 TLS 포트의 핸드셰이크 기한(ms). 공개 포트라 인증 기한이 없으므로 끝낼 시간만 준다(#174).
 * 느린 모바일 클라이언트와 약한 운영 서버(0.5코어·스왑)를 함께 고려해 20초로 둔다(#181).
 */
export const EXTERNAL_TLS_HANDSHAKE_TIMEOUT_MS = 20_000;
/** 외부 TLS 포트마다 핸드셰이크 중일 수 있는 연결 수의 상한(#181). 동시성 상한(admit)은 핸드셰이크 뒤에 걸린다. */
const EXTERNAL_MAX_PENDING_TLS_HANDSHAKES = 1024;
/** 외부 TLS 포트에서 주소 하나(IPv4 하나·IPv6 /64)가 핸드셰이크 중일 수 있는 연결 수(#181). 브라우저는 보통 6개 안팎을 연다. */
const EXTERNAL_MAX_PENDING_TLS_HANDSHAKES_PER_ADDRESS = 64;



interface NewSessionCallback {
    (sessionID:  number, opt: TunnelingOption) : void;
}

interface OnHandlerEventCallback {
    (sessionID:  number, state: SocketState,bundle? : {data? : Buffer, receiveLength: number}) : void;
}

interface OnTerminateSessionCallback {
    (sessionID: number) : void;
}

const OPTION_BUNDLE_KEY : string = "portTunnelOption";
const PORT_BUNDLE_KEY : string = "portNumber";
const SESSION_ID_BUNDLE_KEY : string = "ID";

type ExternalPortServerStatus = {
    port: number,
    online: boolean,
    sessions: number,
    uptime: number,
    active: boolean,
    activeStart: number,
    /** 실제로 걸린 시간(초). 그룹 상한으로 잘렸으면 상한이다. */
    activeTimeout: number,
    /** 사용자가 요청한 시간(초, 0=무기한). 재적용·롤백·상한 변경 때 이 값과 현재 상한으로 다시 계산한다(#137). */
    requestedTimeout?: number,
    rx: number,
    tx: number,
    rejected: {geo: number, rateLimit: number},
    bannedIps: number,
}



const SESSION_CLEANUP_INTERVAL = 10000;

class ExternalPortServerPool {

    private _portServerMap  = new Map<number, TCPServer>();
    private _statusMap  = new Map<number, ExternalPortServerStatus>();
    private _handlerMap = new Map<number, EndpointHandler | EndpointHttpHandler>();

    private _activeTimeoutMap  = new Map<number, any>();
    private _onNewSessionCallback : NewSessionCallback | null = null;
    private _onHandlerEventCallback : OnHandlerEventCallback | null = null;
    private _onTerminateSessionCallback : OnTerminateSessionCallback | null = null;
    // U5-09 / #124 — 그룹 대역폭. 버킷은 풀이 살아 있는 동안만 의미가 있어 풀의 필드 하나로 둔다(싱글턴 없음).
    // 소유자·그룹은 rbac 를 모르도록 정책 함수로 주입받는다.
    private readonly _bandwidth = new BandwidthLimiter();
    private _bandwidthPolicy: ((port: number) => {groupId: string; bytesPerSecond: number} | undefined) | null = null;
    private readonly _sendQueues = new Map<number, SendQueue>();
    // U5-07 / #122 — 포트별 최대 활성 시간(초)과 그 상한으로 만료됐을 때의 알림. rbac 를 모르도록 주입받는다.
    private _activeTimeoutCap : ((port: number) => number | undefined) | null = null;
    private _onAutoExpire : ((port: number, info: {timeoutSeconds: number; cappedByGroup: boolean}) => void) | null = null;
    private _closeWaitTimeout : number = 60 * 1000;

    private static LAST_SESSION_ID = 1;

    private _sessionCleanupIntervalID : any = null;







    public static create(options: Array<TunnelingOption>) : ExternalPortServerPool {
        return new ExternalPortServerPool(options);
    }


    private constructor(options: Array<TunnelingOption>) {
        for(let option of options) {
            try {
                option = this.optionNormalization(option);
            } catch (e) {
                console.error(e);
            }
        }

        this.startSessionCleanup();

        AdmissionController.instance.configureConcurrency((port) => this._statusMap.get(port)?.sessions ?? 0);
    }


    private startSessionCleanup() {
        if(this._sessionCleanupIntervalID) clearInterval(this._sessionCleanupIntervalID);
        this._sessionCleanupIntervalID = setInterval(() => {
                // 매번 현재 시간을 재계산하여 정확한 타임아웃 체크
                const now = Date.now();
                let closeWaitHandlerList : Array<EndpointHandler | EndpointHttpHandler> = Array.from(this._handlerMap.values())
                    .filter((handler: EndpointHandler | EndpointHttpHandler) => {
                    return !!handler.closeWait;

                });
                closeWaitHandlerList.forEach((handler: EndpointHandler | EndpointHttpHandler) => {
                    // null assertion 제거하고 안전한 접근으로 변경
                    let isTimeout = handler.lastSendTime ? (now - handler.lastSendTime > this._closeWaitTimeout) : true;
                    this.closeIfSatisfiedLength(handler, isTimeout);
                });
            },SESSION_CLEANUP_INTERVAL);

    }




    public async startServer(option: TunnelingOption, certInfo?: CertInfo) : Promise<boolean> {

        let server = this._portServerMap.get(option.forwardPort);
        if(server && !server.isEnd()) {
            return false;
        }

        option.keepAlive = option.keepAlive ?? TCPServer.DEFAULT_KEEP_ALIVE
        if(option.keepAlive > 0) {
            option.keepAlive = Math.max(option.keepAlive, 500);
        }


        return new Promise((resolve, reject) => {
            let options = {
                port: option.forwardPort,
                tls: option.tls!,
                key: certInfo?.key.value,
                cert: certInfo?.cert.value,
                ca: certInfo?.ca.value == '' ? undefined : certInfo?.ca.value,
                keepAlive: option.keepAlive,
                // 동시성 상한(admit)은 핸드셰이크가 끝난 뒤에 걸린다. 그 전의 연결이 Node 기본값(120초)까지 남지 않게 한다(#174).
                handshakeTimeoutMs: EXTERNAL_TLS_HANDSHAKE_TIMEOUT_MS,
                maxPendingTlsHandshakes: EXTERNAL_MAX_PENDING_TLS_HANDSHAKES,
                maxPendingTlsHandshakesPerAddress: EXTERNAL_MAX_PENDING_TLS_HANDSHAKES_PER_ADDRESS,
                addressBucketOf: rateLimitBucketOf,
                admit: (addr: string | undefined) => {
                    const protocol = option.protocol ?? 'tcp';
                    const decision = AdmissionController.instance.admit({kind: 'tunnel', port: option.forwardPort, protocol}, addr);
                    if(!decision.allowed && decision.reason === 'concurrency-limit' && (protocol === 'http' || protocol === 'https')) {
                        return {...decision, rejectResponse: HTTP_503};
                    }
                    return decision;
                }
            }
            let portServer : TCPServer = TCPServer.create(options);
            AdmissionController.instance.configureTunnel(option);

            portServer.setOnServerEvent(this.onServerEvent);
            portServer.setOnHandlerEvent(this.onHandlerEvent);
            portServer.setBundle(OPTION_BUNDLE_KEY, option);
            if(!option.inactiveOnStartup) option.inactiveOnStartup = false;
            this._statusMap.set(option.forwardPort, {port: option.forwardPort, online: false, sessions: 0, rx: 0, tx: 0, uptime: 0,
                // 켜진 채 기동한 터널도 시작 시각을 둔다. 0 이면 상한을 다시 계산할 때 마감이 과거가 되어 바로 만료된다(#137).
                active: !option.inactiveOnStartup, activeTimeout: 0, activeStart: Date.now(),
                rejected: {geo: 0, rateLimit: 0}, bannedIps: 0});
            portServer.start((err?: Error) => {
                if(err) {
                    logger.error(`startServer - port: ${option.forwardPort}`, err);
                    AdmissionController.instance.releaseTunnel(option.forwardPort);
                    reject(err);
                    return;
                }
                let status = this._statusMap.get(option.forwardPort);
                if(status) {
                    status.online = true;
                    status.uptime = Date.now();
                }
                let simpleOption = ObjectUtil.cloneDeep(option) as any;
                delete simpleOption['certInfo'];
                logger.info(`startServer - port: ${option.forwardPort}, option: ${JSON.stringify(simpleOption)}`);
                this._portServerMap.set(option.forwardPort, portServer);


                resolve(true);
            });
        })
    }


    private optionNormalization(option: TunnelingOption) : TunnelingOption {
        if(option.tls == undefined) {
            option.tls = false;
        }
        if(option.protocol == "http" && option.destinationPort == undefined) {
            option.destinationPort = 80;
        }
        else if(option.protocol == "https") {
            if(option.destinationPort == undefined) option.destinationPort = 443;
            option.tls = true;
        }

        if(option.destinationPort == undefined) {
            throw new Error("DestinationPort is undefined");
        }

        return option;


    }

    public set OnNewSessionCallback(callback: NewSessionCallback)  {
        this._onNewSessionCallback = callback;
    }

    public set OnHandlerEventCallback(callback: OnHandlerEventCallback)  {
        this._onHandlerEventCallback = callback;
    }

    public set OnTerminateSessionCallback(callback: OnTerminateSessionCallback)  {
        this._onTerminateSessionCallback = callback;
    }

    public set BandwidthPolicy(policy: ((port: number) => {groupId: string; bytesPerSecond: number} | undefined) | null) {
        this._bandwidthPolicy = policy;
    }

    public set ActiveTimeoutCap(cap: ((port: number) => number | undefined) | null) {
        this._activeTimeoutCap = cap;
    }

    public set OnAutoExpireCallback(callback: ((port: number, info: {timeoutSeconds: number; cappedByGroup: boolean}) => void) | null) {
        this._onAutoExpire = callback;
    }


    /**
     * P3-T5 / REQ-08: 외부 TLS 포트 인증서 hot-apply.
     * 해당 포트가 TLS 서버가 아니거나 종료 상태면 false.
     */
    public applyTlsCertificateHotSwap(port: number, certInfo?: CertInfo): boolean {
        if(!certInfo) return false;
        const server = this._portServerMap.get(port);
        if(!server) return false;
        return server.applyTlsCertificateHotSwap({
            key: certInfo.key.value,
            cert: certInfo.cert.value,
            ca: certInfo.ca.value && certInfo.ca.value.length > 0 ? certInfo.ca.value : undefined
        });
    }

    public getServerStatus(port: number) : ExternalPortServerStatus  {
        let status = this._statusMap.get(port);
        if(!status) {
            return {port: port, online: false, sessions: 0, rx: 0, tx: 0, uptime: 0, active: false, activeTimeout : 0, activeStart: 0,
                rejected: {geo: 0, rateLimit: 0}, bannedIps: 0};
        }
        const denials = AdmissionController.instance.denials(port);
        status.rejected.geo = denials.geo;
        status.rejected.rateLimit = denials.rateLimit;
        status.bannedIps = AdmissionController.instance.rateLimiter.stats(port).bannedIps;
        return status;

    }


    /** 소켓 출력 백프레셔 또는 #124 대역폭 큐가 상단 워터마크에 이른 상태. TTTServer 가 터널 소스를 멈추는 기준이다. */
    public isSessionBackpressured(id: number) : boolean {
        return (this._handlerMap.get(id)?.isBackpressured ?? false) || this.isQueuePressured(id);
    }

    /** #163: 업로드 방향 배압. 터널 데이터 소켓이 밀리는 동안 외부 소켓 읽기를 멈춘다. */
    public pauseSessionRead(id: number) : void {
        this._handlerMap.get(id)?.pauseRead('upstream');
    }

    public resumeSessionRead(id: number) : void {
        this._handlerMap.get(id)?.resumeRead('upstream');
    }

    public addSessionPressureReliefListener(id: number, listener: () => void) : void {
        const queue = this._sendQueues.get(id);
        if(this.isGlobalQueuePressured(id) && !(queue && this.isOwnQueuePressured(id))) {
            // 전체 대역폭 큐가 예산 하단 아래로 비면 부른다(#183).
            this._globalReliefListeners.add(listener);
            return;
        }
        if(queue && this.isQueuePressured(id)) {
            // 대역폭 큐가 하단 워터마크 아래로 비면 drain 이 부른다.
            queue.reliefListeners.push(listener);
            return;
        }
        const handler = this._handlerMap.get(id);
        if(handler) {
            handler.addOncePressureReliefListener(() => listener());
        }
    }

    private isQueuePressured(id: number): boolean {
        return this.isOwnQueuePressured(id) || this.isGlobalQueuePressured(id);
    }

    private isOwnQueuePressured(id: number): boolean {
        const queue = this._sendQueues.get(id);
        return queue !== undefined && queue.bytes >= computeWatermarkBytes(queue.limit).high;
    }

    /**
     * 세션별 상한(기본 8MiB)은 세션 수만큼 곱해져 512MB 서버의 메모리를 넘을 수 있다(#183). 모든 대역폭 큐의 합이
     * 전체 예산의 상단에 이르면 대역폭 정책이 걸린 세션의 원천 읽기를 멈춘다. 데이터를 버리지 않는다.
     */
    private isGlobalQueuePressured(id: number): boolean {
        const budget = ResourcePolicyRegistry.current().globalBandwidthQueueLimitBytes;
        if(budget <= 0 || this._queuedBandwidthBytes < computeWatermarkBytes(budget).high) return false;
        // 자기 큐가 있는 세션만 멈춘다. 큐가 없는 세션은 메모리를 쓰지 않으므로 느린 그룹 때문에 멈추지 않는다.
        return this._sendQueues.has(id);
    }

    private releaseQueuedBandwidthBytes(bytes: number): void {
        this._queuedBandwidthBytes = Math.max(0, this._queuedBandwidthBytes - bytes);
        const budget = ResourcePolicyRegistry.current().globalBandwidthQueueLimitBytes;
        if(this._globalReliefListeners.size === 0 || (budget > 0 && this._queuedBandwidthBytes > computeWatermarkBytes(budget).low)) return;
        const listeners = [...this._globalReliefListeners];
        this._globalReliefListeners.clear();
        for(const listener of listeners) listener();
    }

    private _queuedBandwidthBytes = 0;
    private _globalReliefListeners: Set<() => void> = new Set();

    public send(id: number, data: Buffer) : boolean {
        let handler = this._handlerMap.get(id);
        if(handler) {
            if(handler.closeInitiated) return false;
            // 대역폭 큐에 남은 바이트도 이미 보낸 것으로 친다(아직 쓰지 않았을 뿐이다).
            const queuedBytes = this._sendQueues.get(id)?.bytes ?? 0;
            if(handler instanceof HttpHandler && handler.closeWait &&
                handler.responseInputLength + queuedBytes + data.length > handler.endLength!) {
                this.closeIfSatisfiedLength(handler, true);
                return false;
            }
            // 대역폭 큐가 있으면 정책과 무관하게 순서를 지키도록 뒤에 붙인다(정책이 사라져도 drain 이 비운다).
            // 청크는 합치거나 쪼개지 않는다.
            const queue = this._sendQueues.get(id);
            if(queue) return this.enqueue(id, handler, queue, data);
            const portNumber: number = handler.getBundle(PORT_BUNDLE_KEY);
            const policy = this._bandwidthPolicy?.(portNumber);
            if(!policy) {
                this.writeToHandler(handler, data);
                return true;
            }
            const wait = this._bandwidth.consume(policy.groupId, policy.bytesPerSecond, data.length, Date.now());
            if(wait === 0) {
                this.writeToHandler(handler, data);
                return true;
            }
            const configured = handler.getBundle(OPTION_BUNDLE_KEY)?.bufferLimitOnServer;
            const created: SendQueue = {chunks: [], bytes: 0, timer: null, reliefListeners: [],
                limit: (typeof configured === 'number' && configured > 0 ? configured : 8) * 1024 * 1024};
            this._sendQueues.set(id, created);
            if(!this.enqueue(id, handler, created, data)) return false;
            this.scheduleDrain(id, wait);
            return true;
        }
        return false;
    }

    /** 클라이언트→외부 실제 쓰기. 대역폭 큐가 비울 때와 정책이 없을 때 같은 경로를 쓴다. */
    private writeToHandler(handler: EndpointHandler | EndpointHttpHandler, data: Buffer): void {
        handler.lastSendTime = Date.now();
        handler.sendData(data, (sent: SocketHandler, success: boolean) => {
            this.onSendDataCallback(sent, success);
        });
        if(handler instanceof HttpHandler) this.closeIfSatisfiedLength(handler);
        const status = this._statusMap.get(handler.getBundle(PORT_BUNDLE_KEY));
        if(status) {
            status.tx += data.length;
        }
    }

    /** 큐 상한을 넘으면 데이터를 버리고 계속 가지 않고 세션을 닫는다. */
    private enqueue(id: number, handler: EndpointHandler | EndpointHttpHandler, queue: SendQueue, data: Buffer): boolean {
        queue.chunks.push(data);
        queue.bytes += data.length;
        this._queuedBandwidthBytes += data.length;
        if(queue.bytes > queue.limit) {
            this.clearSendQueue(id);
            this.closeIfSatisfiedLength(handler, true);
            return false;
        }
        return true;
    }

    private scheduleDrain(id: number, wait: number): void {
        const queue = this._sendQueues.get(id);
        if(!queue) return;
        queue.timer = setTimeout(() => this.drain(id), wait);
    }

    private drain(id: number): void {
        const queue = this._sendQueues.get(id);
        if(!queue) return;
        queue.timer = null;
        const handler = this._handlerMap.get(id);
        if(!handler || handler.closeInitiated) {
            this.clearSendQueue(id);
            return;
        }
        while(queue.chunks.length > 0) {
            const head = queue.chunks.shift()!;
            queue.bytes -= head.length;
            this.releaseQueuedBandwidthBytes(head.length);
            this.writeToHandler(handler, head);
            // 쓰는 중 핸들러가 닫혀 큐가 정리되었으면 남은 청크를 다시 빼지 않는다(#183).
            if(this._sendQueues.get(id) !== queue) return;
            this.notifyQueueRelief(queue);
            const next = queue.chunks[0];
            if(next === undefined) break;
            const policy = this._bandwidthPolicy?.(handler.getBundle(PORT_BUNDLE_KEY));
            const wait = policy ? this._bandwidth.consume(policy.groupId, policy.bytesPerSecond, next.length, Date.now()) : 0;
            if(wait > 0) {
                this.scheduleDrain(id, wait);
                return;
            }
        }
        this._sendQueues.delete(id);
        this.notifyQueueRelief(queue, true);
        this.closeIfSatisfiedLength(handler);
    }

    /** 큐가 하단 워터마크 아래로 내려가면(또는 비면) 멈춰 둔 터널 소스를 다시 흐르게 한다. */
    private notifyQueueRelief(queue: SendQueue, emptied: boolean = false): void {
        if(queue.reliefListeners.length === 0) return;
        if(!emptied && queue.bytes > computeWatermarkBytes(queue.limit).low) return;
        const listeners = queue.reliefListeners.splice(0);
        for(const listener of listeners) listener();
    }

    private clearSendQueue(id: number): void {
        const queue = this._sendQueues.get(id);
        if(!queue) return;
        if(queue.timer) clearTimeout(queue.timer);
        this._sendQueues.delete(id);
        this.releaseQueuedBandwidthBytes(queue.bytes);
        queue.bytes = 0;
        queue.chunks.length = 0;
    }

    private onSendDataCallback = (handler: SocketHandler,success: boolean) : void => {
        if(success) {
            this.closeIfSatisfiedLength(handler);
        }
    }

    public closeSession(id: number, endLength: number) : void {
        let handler = this._handlerMap.get(id);
        if(handler) {
            if(handler.closeInitiated) return;
            if(handler instanceof HttpHandler && (!Number.isSafeInteger(endLength) || endLength < 0 ||
                endLength < handler.responseInputLength || (handler.closeWait && handler.endLength !== endLength))) {
                this.closeIfSatisfiedLength(handler, true);
                return;
            }
            handler.endLength = endLength;
            handler.closeWait = true;
            this.closeIfSatisfiedLength(handler);
        }
    }

    private closeIfSatisfiedLength(endPointClient: EndpointHandler | EndpointHttpHandler, force: boolean = false) {
        if(this._handlerMap.get(endPointClient.sessionID!) !== endPointClient || endPointClient.closeInitiated) return;
        if(!force && endPointClient instanceof HttpHandler && endPointClient.closeWait) {
            if(endPointClient.responseInputLength !== endPointClient.endLength) return;
            if(!endPointClient.responseInputEnded) endPointClient.endResponseInput();
            if(this._handlerMap.get(endPointClient.sessionID!) !== endPointClient || endPointClient.closeInitiated) return;
        }
        const ready = endPointClient.closeWait && (endPointClient.endLength ?? 0) <= endPointClient.sendLength && endPointClient.isOutputDrained;
        if((ready || force) && !endPointClient.closeInitiated) {
            endPointClient.closeInitiated = true;
            if(force) {
                endPointClient.destroy();
                return;
            }
            endPointClient.end_();
        }
    }




    private onHandlerEvent = (handler: EndpointHandler | EndpointHttpHandler, state: SocketState, data?: any) : void => {
        let sessionID = handler.getBundle(SESSION_ID_BUNDLE_KEY)!;
        if(this._handlerMap.get(sessionID) !== handler) return;

            if (SocketState.Receive == state) {
                let portNumber: number = handler.getBundle(PORT_BUNDLE_KEY);
                let status = this._statusMap.get(portNumber);
                if (status) {
                    status.rx += data.length;
                }


                this._onHandlerEventCallback?.(sessionID, state, {data: data, receiveLength: handler.receiveLength});
                // 외부→클라이언트 방향 대역폭. 버킷 빚만큼 읽기를 멈춘다. 백프레셔로 멈춘 상태는 풀지 않는다.
                const policy = this._bandwidthPolicy?.(portNumber);
                if(policy) {
                    const wait = this._bandwidth.consume(policy.groupId, policy.bytesPerSecond, data.length, Date.now());
                    if(wait > 0) {
                        handler.pauseRead('bandwidth');
                        setTimeout(() => handler.resumeRead('bandwidth'), wait).unref();
                    }
                }
            } else if (sessionID && (state == SocketState.End || state == SocketState.Closed)) {
                this.updateCount(handler.getBundle(OPTION_BUNDLE_KEY).forwardPort, false);
                this.clearSendQueue(sessionID);
                if (this._handlerMap.has(sessionID)) {
                    this._onHandlerEventCallback?.(sessionID, SocketState.Closed, {
                        data: data,
                        receiveLength: handler.breakBufferFlush ? 0 :  handler.receiveLength!
                    });
                    this._handlerMap.delete(sessionID);
                }
                setImmediate(() => {
                    this._onTerminateSessionCallback?.(sessionID);
                });
                logger.info(`End - id: ${sessionID}, port: ${handler.getBundle(OPTION_BUNDLE_KEY).forwardPort}`);
                handler.destroy();
            } else if (SocketState.Closed == state) {

            }

    }

    private onServerEvent = (server: TCPServer, state: SocketState, handlerOpt?: SocketHandler) : void => {
        if(SocketState.Listen == state) {
            logger.info(`Listen - port: ${server.port}`);
        }
        if(server.isEnd()) {
            let error = server.getError();
            if(error) {
                logger.error(`Error - port: ${server.port}`,error);
            }
            else logger.info(`End - port: ${server.port}`);
            let forwardPort = server.port;
            this._portServerMap.delete(forwardPort);
            let status = this._statusMap.get(forwardPort);
            if(status) {
                status.online = false;
                status.sessions = 0;
            }
        } else if(state == SocketState.Bound) {
            let handler = handlerOpt!;
            let option = server.getBundle(OPTION_BUNDLE_KEY);
            if(!option) {
                logger.error(`Error - port: ${server.port}, Option is undefined`);
                handler.destroy();
                server.stop();
                return;
            }
            if(handler.socket && option.keepAlive > 0) {
                handler.socket.setNoDelay(true);
                handler.socket.setKeepAlive(true, option.keepAlive);
            }
            let status = this._statusMap.get(server.port);
            if(status && !status.active) {
                handler.end_();
                return;
            }
            option = option as TunnelingOption;
            let sessionID = ExternalPortServerPool.LAST_SESSION_ID++;
            handler.setBundle(SESSION_ID_BUNDLE_KEY, sessionID);

            let bufferSizeLimit = option.bufferLimitOnServer == undefined || option.bufferLimitOnServer < 1 ? - 1 :  option.bufferLimitOnServer * 1024 * 1024;
            handler.setBufferSizeLimit(bufferSizeLimit);
            handler.setBundle(OPTION_BUNDLE_KEY, option);
            handler.setBundle(PORT_BUNDLE_KEY, server.port);

            if(option.protocol == "http" || option.protocol == "https") {
                logger.info(`Bound HttpHandler - id:${sessionID}, port:${server.port}, remote:(${handler.socket.remoteAddress})${handler.socket.remotePort}`);
                let httpHandler = HttpHandler.create(handler, option);
                httpHandler.onSocketEvent = this.onHandlerEvent;
                this.initEndPointInfo(httpHandler as EndpointHttpHandler, sessionID, 'http');
                this._handlerMap.set(sessionID, httpHandler);
                httpHandler.onOutputProgress = () => {
                    if(this._handlerMap.get(sessionID) === httpHandler) this.closeIfSatisfiedLength(httpHandler);
                };
            } else {
                logger.info(`Bound SocketHandler - id:${sessionID}, port: ${server.port}, remote:(${handler.socket.remoteAddress})${handler.socket.remotePort}`);
                this.initEndPointInfo(handler as EndpointHandler, sessionID, 'tcp');
                this._handlerMap.set(sessionID, handler);
            }
            this.updateCount(server.port, true);
            this._onNewSessionCallback?.(sessionID, option);
        }
    }

    private initEndPointInfo(endpointInfo: EndPointInfo, sessionID: number, type: 'http' | 'tcp') {
        endpointInfo.closeWait = false;
        endpointInfo.closeInitiated = false;
        endpointInfo.endLength = 0;
        endpointInfo.lastSendTime = Date.now();
        endpointInfo.sessionID = sessionID;
        endpointInfo.protocolType = type;
    }

    private updateCount(port: number, increase: boolean) : void {
        let status = this._statusMap.get(port);
        if(!status) {
            return;
        }
        status.sessions += increase ? 1 : -1;
        status.sessions = Math.max(0, status.sessions);
    }

    public async stop(port: number) : Promise<boolean> {
        let server = this._portServerMap.get(port);
        if(!server) {
            return false;
        }
        this.clearActiveTimeout(port);
        await this.removeHandlerByForwardPort(port);
        return new Promise((resolve) => {
            server?.stop((err?: Error) => {
                const status = this._statusMap.get(port);
                if(status) {
                    status.online = false;
                    status.sessions = 0;
                }
                AdmissionController.instance.releaseTunnel(port);
                resolve(err == undefined);
            });
        })
    }

    private async destroyHandlers(ids: Array<number>) : Promise<void> {
        let handlers : Array<SocketHandler | HttpHandler> = [];
        for(let id of ids) {
            let handler = this._handlerMap.get(id);
            this.clearSendQueue(id);
            if(handler) {
                handlers.push(handler);
                handler.destroy();
            }
        }
        return new Promise((resolve) => {
            if(handlers.length == 0) {
                resolve();
                return;
            }
            while(handlers.length > 0) {
                let handler = handlers.pop()!;
                handler.destroy();
            }
            resolve();
        });
    }

    private async removeHandlerByForwardPort(port: number) : Promise<void> {

        let ids = Array.from(this._handlerMap.values())
            .filter((handler: SocketHandler | HttpHandler)=> handler.getBundle(OPTION_BUNDLE_KEY)?.forwardPort == port )
            .map((handler: SocketHandler | HttpHandler) => { return handler.getBundle(SESSION_ID_BUNDLE_KEY)!; });
        await this.destroyHandlers(ids);
    }

    public async inactive(port: number) : Promise<boolean> {
        let status = this._statusMap.get(port);
        if(!status) {
            return false;
        }
        this.clearActiveTimeout(port);
        status.active = false;
        await this.removeHandlerByForwardPort(port);
        return true;
    }


    public setActiveTimeout(port: number, timeout: number) : boolean {
        let status = this._statusMap.get(port);
        if(!status) {
            return false;
        }
        status.activeTimeout = timeout;
        status.requestedTimeout = timeout;
        return true;
    }

    /**
     * 켜져 있는 터널의 수명 상한을 다시 계산한다. 시작 시각은 그대로 두므로 연장되지 않는다(#137).
     * 소유자·사용자 그룹·그룹 속성이 바뀐 뒤 부른다.
     */
    public async reapplyActiveCap(port: number) : Promise<void> {
        const status = this._statusMap.get(port);
        if(!status || !status.active) return;
        await this.active(port, status.requestedTimeout ?? status.activeTimeout, {startedAt: status.activeStart});
    }

    public async active(port: number, timeout?: number, options: {startedAt?: number} = {}) : Promise<boolean> {
        let status = this._statusMap.get(port);
        if(!status) {
            return false;
        }
        if(timeout == undefined) timeout = status.requestedTimeout ?? status.activeTimeout;
        const requested = timeout;
        // 상한이 있으면 타임아웃 없음(0 이하)과 상한보다 긴 요청을 상한으로 자른다.
        // 상한과 같은 값도 상한 만료로 본다. 재적용(restoreExternalPortStatus)은 이미 잘린 값을 다시 넘기므로,
        // '<' 로 비교하면 옵션을 고쳐 터널을 다시 만든 뒤의 만료가 감사에서 빠진다.
        const cap = this._activeTimeoutCap?.(port);
        const cappedByGroup = cap !== undefined && (timeout <= 0 || cap <= timeout);
        if(cappedByGroup) timeout = cap!;
        const effectiveTimeout = timeout;
        this.clearActiveTimeout(port);
        status.active = true;
        status.activeTimeout = timeout;
        status.requestedTimeout = requested;
        // 재적용·롤백·상한 재계산은 원래 시작 시각을 넘긴다. 처음부터 다시 걸면 만료가 계속 미뤄진다(#137).
        status.activeStart = options.startedAt !== undefined && options.startedAt > 0 ? options.startedAt : Date.now();
        if(timeout > 0){
            this.scheduleExpiry(port, status.activeStart + timeout * 1000, async () => {
                await this.inactive(port);
                this._onAutoExpire?.(port, {timeoutSeconds: effectiveTimeout, cappedByGroup});
            });
        }
        return true;
    }

    /**
     * deadline 에 onExpire 를 부른다. Node 는 2^31-1ms(약 24.8일)를 넘는 setTimeout 지연을 1ms 로 바꾸므로(#141),
     * 상한 이하로 나눠 걸고 깰 때마다 남은 시간을 다시 건다. 다른 타이머로 바뀌었거나 지워졌으면 아무 일도 하지 않는다.
     */
    private scheduleExpiry(port: number, deadline: number, onExpire: () => Promise<void>): void {
        const delay = Math.min(Math.max(deadline - Date.now(), 0), MAX_TIMER_DELAY_MS);
        const timeoutCtrl: NodeJS.Timeout = setTimeout(() => {
            if(this._activeTimeoutMap.get(port) !== timeoutCtrl) return;
            if(Date.now() < deadline) {
                this.scheduleExpiry(port, deadline, onExpire);
                return;
            }
            void onExpire();
        }, delay);
        this._activeTimeoutMap.set(port, timeoutCtrl);
    }


    public async stopAll() : Promise<void> {
        if(this._sessionCleanupIntervalID) {
            clearInterval(this._sessionCleanupIntervalID);
            this._sessionCleanupIntervalID = null;
        }
        this._activeTimeoutMap.forEach((_, port) => this.clearActiveTimeout(port));
        this._globalReliefListeners.clear();
        logger.info(`closeAll`);
        let callbackCount = this._portServerMap.size;
        if(callbackCount == 0) return;
        return new Promise((resolve) => {
            this._portServerMap.forEach((server: TCPServer, port: number) => {
                server.stop(() => {
                    let status = this._statusMap.get(port);
                    if(status) {
                        status.online = false;
                        status.sessions = 0;
                    }
                    AdmissionController.instance.releaseTunnel(port);
                    callbackCount--;
                    logger.info(`close - port: ${port}, left count: ${callbackCount}`);
                    if(callbackCount == 0) {
                        logger.info(`closeAll - done`);
                        this._portServerMap.clear();
                        this._handlerMap.clear();
                        resolve();
                    }
                });
            });
        });
    }

    public async dispose(): Promise<void> {
        await this.stopAll();
    }

    private clearActiveTimeout(port: number): void {
        const timeoutCtrl = this._activeTimeoutMap.get(port);
        if(timeoutCtrl != undefined) {
            clearTimeout(timeoutCtrl);
            this._activeTimeoutMap.delete(port);
        }
    }
}


export { ExternalPortServerPool, ExternalPortServerStatus };

import {ExternalPortServerPool, ExternalPortServerStatus } from "./ExternalPortServerPool";
import {TunnelServer, ClientStatus} from "./TunnelServer";
import {ServerOption, TunnelingOption} from "../types/TunnelingOption";
import SocketState from "../util/SocketState";
import {CertInfo, CertificationStore} from "./CertificationStore";
import ServerOptionStore from "./ServerOptionStore";
import LoggerFactory  from "../util/logger/LoggerFactory";
import {SysInfo} from "../commons/SysMonitor";
import AppCompositionRoot from "../bootstrap/AppCompositionRoot";
import ObjectUtil from "../util/ObjectUtil";
const logger = LoggerFactory.getLogger('server', 'TTTServer');

type RuntimeApplyResult = {
    success: boolean;
    partial: boolean;
    warnings: string[];
    failedScopes: string[];
    restartRequiredScopes: string[];
}


/**
  ExportPortServerPool은 외부에서 들어온 handler 만 관리한다.
  Ctrl 은 TunnelServer에서 관리한다.
 */


class TTTServer {

    private _externalPortServerPool : ExternalPortServerPool;
    private _tunnelServer : TunnelServer;
    private _sessions : Set<number> = new Set<number>();
    private _allowClientNamesMap : Map<number, Array<string>> = new Map<number, Array<string>>();
    private _allowClientIdsMap : Map<number, Array<string>> = new Map<number, Array<string>>();


    public static create(serverOption: ServerOption) : TTTServer {
        return new TTTServer(serverOption);
    }

    private constructor(serverOption: ServerOption) {
        if(serverOption.tls == undefined) serverOption.tls = false;
        this._externalPortServerPool = ExternalPortServerPool.create(serverOption.tunnelingOptions);
        this._tunnelServer = this.createTunnelServer(serverOption);
        this._externalPortServerPool.OnHandlerEventCallback = this.onHandlerEventOnExternalPortServer;
        this._externalPortServerPool.OnNewSessionCallback = this.onNewSession;
        this._externalPortServerPool.OnTerminateSessionCallback = this.OnTerminateSession;
        this.syncAllowedClientMaps(serverOption);
    }

    private syncAllowedClientMaps(serverOption: ServerOption): void {
        this._allowClientNamesMap.clear();
        this._allowClientIdsMap.clear();
        serverOption.tunnelingOptions.forEach((option) => {
            if(option.allowedClientIds && option.allowedClientIds.length > 0) {
                this._allowClientIdsMap.set(option.forwardPort, option.allowedClientIds);
            }
            if(option.allowedClientNames && option.allowedClientNames.length > 0) {
                this._allowClientNamesMap.set(option.forwardPort, option.allowedClientNames!);
            }
        });
    }

    private bindTunnelServerCallbacks(tunnelServer: TunnelServer): void {
        tunnelServer.onSessionCloseCallback = this.onSessionClosed;
        tunnelServer.onReceiveDataCallback = this.onSessionDataReceived;
    }

    private createTunnelServer(serverOption: ServerOption): TunnelServer {
        const tempCert = CertificationStore.instance.getTempCert();
        const tunnelServer = TunnelServer.create({
            port: serverOption.port,
            key: serverOption.key,
            tls: serverOption.tls === true,
            keepAlive: serverOption.keepAlive,
            controlProtocolMode: serverOption.controlProtocolMode ?? "mixed",
            allowLegacyControlAuth: serverOption.allowLegacyControlAuth === true,
            trustedClients: serverOption.trustedClients ?? []
        }, tempCert);
        this.bindTunnelServerCallbacks(tunnelServer);
        return tunnelServer;
    }

    private applyAllowedClientsForPort(option?: TunnelingOption): void {
        if(!option) {
            return;
        }
        this._allowClientNamesMap.delete(option.forwardPort);
        this._allowClientIdsMap.delete(option.forwardPort);
        if(option.allowedClientIds && option.allowedClientIds.length > 0) {
            this._allowClientIdsMap.set(option.forwardPort, option.allowedClientIds);
        }
        if(option.allowedClientNames && option.allowedClientNames.length > 0) {
            this._allowClientNamesMap.set(option.forwardPort, option.allowedClientNames);
        }
    }

    private async restoreExternalPortStatus(port: number, option: TunnelingOption, lastServerStatus: ExternalPortServerStatus): Promise<void> {
        this._externalPortServerPool.setActiveTimeout(port, lastServerStatus.activeTimeout);
        if(lastServerStatus.active && !option.inactiveOnStartup) {
            await this._externalPortServerPool.active(port, lastServerStatus.activeTimeout);
            return;
        }
        if(!lastServerStatus.active) {
            await this._externalPortServerPool.inactive(port);
        }
    }



    private onNewSession = (id: number, opt: TunnelingOption) : void => {
        let bufferLimitOnClient = opt.bufferLimitOnClient == undefined || opt.bufferLimitOnClient < 1 ? -1 : opt.bufferLimitOnClient! * 1024 * 1024;
        this._sessions.add(id);
        let allowClientIds = this._allowClientIdsMap.get(opt.forwardPort);
        let allowClientNames = this._allowClientNamesMap.get(opt.forwardPort);
        let success = this._tunnelServer.openSession(id, {host: opt.destinationAddress,port: opt.destinationPort!,tls: opt.tls,bufferLimit: bufferLimitOnClient},allowClientNames, allowClientIds);
        if(!success) {
            this._sessions.delete(id);
            this._externalPortServerPool.closeSession(id,0);
        }
    }

    private OnTerminateSession = (sessionID: number) : void => {
        this._tunnelServer.terminateSession(sessionID);
        this._sessions.delete(sessionID);

    }

    private onHandlerEventOnExternalPortServer = (id: number, state: SocketState,bundle? : {data? : Buffer, receiveLength: number}) : void => {
        if(this.isEndState(state)) {
            this._tunnelServer.closeSession(id, bundle?.receiveLength ?? 0);
        } else if(state == SocketState.Receive) {
            if (!bundle?.data) {
                logger.error(`onHandlerEventOnExternalPortServer - bundle or data is undefined for session: ${id}, state: ${state}`);
                return;
            }
            this._tunnelServer.sendBuffer(id, bundle.data);
        }
    }

    private onSessionClosed = (id: number, endLength: number) : void => {
        this._externalPortServerPool.closeSession(id,endLength);
    }

    private onSessionDataReceived = (id: number, data: Buffer) : void => {
        if(!this._externalPortServerPool.send(id, data)) {
            // P6-T1 / REQ-09: 외부 송신 실패 시 "좀비 세션" 방지 위해 터널 세션을 닫는다.
            // (기존에는 주석 처리되어 있었으나, Pool swap/재통보 시 active하지 않은 세션이 남는 원인이었음.)
            this._tunnelServer.closeSession(id, 0);
        }
    }


    private isEndState (state: SocketState) : boolean  {
        return state == SocketState.Closed || state == SocketState.End  /*|| state == SocketState.Error;*/;
    }


    public externalServerStatuses() : Array<ExternalPortServerStatus> {
        let result = new Array<ExternalPortServerStatus>();
        let serverOption = ServerOptionStore.instance.serverOption;
        for(let tunnelOption of serverOption.tunnelingOptions) {
            result.push(this._externalPortServerPool.getServerStatus(tunnelOption.forwardPort));
        }
        return result;
    }


    public externalServerStatus(port: number) : ExternalPortServerStatus {
        return this._externalPortServerPool.getServerStatus(port);
    }

    public clientStatus() : Array<ClientStatus> {
        return this._tunnelServer.clientStatuses();
    }

    public async applyServerOption(nextOption: ServerOption, previousOption: ServerOption): Promise<RuntimeApplyResult> {
        const restartRequiredScopes: string[] = [];
        const warnings: string[] = [];

        if(previousOption.adminPort !== nextOption.adminPort || previousOption.adminBindHost !== nextOption.adminBindHost || previousOption.adminTls !== nextOption.adminTls) {
            restartRequiredScopes.push("admin-server");
            warnings.push("admin listener changes require process restart");
        }

        if(previousOption.globalMemCacheLimit !== nextOption.globalMemCacheLimit) {
            AppCompositionRoot.applyGlobalMemLimitMiB(nextOption.globalMemCacheLimit ?? 128);
        }

        const requiresTunnelRestart = previousOption.port !== nextOption.port
            || previousOption.tls !== nextOption.tls
            || previousOption.key !== nextOption.key
            || previousOption.keepAlive !== nextOption.keepAlive
            || previousOption.controlProtocolMode !== nextOption.controlProtocolMode
            || previousOption.allowLegacyControlAuth !== nextOption.allowLegacyControlAuth
            || !ObjectUtil.canonicalEquals(previousOption.trustedClients ?? [], nextOption.trustedClients ?? []);

        if(!requiresTunnelRestart) {
            this.syncAllowedClientMaps(nextOption);
            return {
                success: true,
                partial: restartRequiredScopes.length > 0,
                warnings,
                failedScopes: [],
                restartRequiredScopes
            };
        }

        const oldTunnelServer = this._tunnelServer;
        try {
            await oldTunnelServer.close();
            const nextTunnelServer = this.createTunnelServer(nextOption);
            await nextTunnelServer.start();
            this._tunnelServer = nextTunnelServer;
            this.syncAllowedClientMaps(nextOption);
            return {
                success: true,
                partial: restartRequiredScopes.length > 0,
                warnings,
                failedScopes: [],
                restartRequiredScopes
            };
        } catch (error) {
            logger.error(`applyServerOption failed`, error);
            try {
                const restoredTunnelServer = this.createTunnelServer(previousOption);
                await restoredTunnelServer.start();
                this._tunnelServer = restoredTunnelServer;
                this.syncAllowedClientMaps(previousOption);
            } catch (restoreError) {
                logger.error(`applyServerOption restore failed`, restoreError);
            }
            return {
                success: false,
                partial: false,
                warnings,
                failedScopes: ["tunnel-control"],
                restartRequiredScopes
            };
        }
    }

    public async applyTunnelingOption(nextOption: TunnelingOption, previousOption?: TunnelingOption): Promise<RuntimeApplyResult> {
        const port = nextOption.forwardPort;
        const lastServerStatus = this._externalPortServerPool.getServerStatus(port);
        const nextCert = CertificationStore.instance.getExternalCert(port);

        try {
            if(lastServerStatus.online) {
                const stopped = await this._externalPortServerPool.stop(port);
                if(!stopped) {
                    throw new Error(`failed to stop listener ${port}`);
                }
            }
            await this._externalPortServerPool.startServer(nextOption, nextCert);
            await this.restoreExternalPortStatus(port, nextOption, lastServerStatus);
            this.applyAllowedClientsForPort(nextOption);
            return {
                success: true,
                partial: false,
                warnings: [],
                failedScopes: [],
                restartRequiredScopes: []
            };
        } catch (error) {
            logger.error(`applyTunnelingOption failed - port: ${port}`, error);
            if(previousOption) {
                try {
                    await this._externalPortServerPool.startServer(previousOption, nextCert);
                    await this.restoreExternalPortStatus(port, previousOption, lastServerStatus);
                    this.applyAllowedClientsForPort(previousOption);
                } catch (restoreError) {
                    logger.error(`applyTunnelingOption restore failed - port: ${port}`, restoreError);
                }
            } else {
                this._allowClientNamesMap.delete(port);
                this._allowClientIdsMap.delete(port);
            }
            return {
                success: false,
                partial: false,
                warnings: [],
                failedScopes: [`external-listener:${port}`],
                restartRequiredScopes: []
            };
        }
    }

    public async applyExternalServerCert(port: number, nextCert: CertInfo, previousCert: CertInfo): Promise<RuntimeApplyResult> {
        const currentOption = ServerOptionStore.instance.getTunnelingOption(port);
        if(!currentOption || currentOption.tls !== true) {
            return {
                success: true,
                partial: false,
                warnings: [`external cert for ${port} stored for next TLS listener start`],
                failedScopes: [],
                restartRequiredScopes: []
            };
        }
        const lastServerStatus = this._externalPortServerPool.getServerStatus(port);
        if(!lastServerStatus.online) {
            return {
                success: true,
                partial: false,
                warnings: [`external cert for ${port} stored while listener is offline`],
                failedScopes: [],
                restartRequiredScopes: []
            };
        }
        try {
            // P3-T5 / REQ-08: 하향 호환성 있는 경우 setSecureContext 기반 hot-swap 우선 시도.
            //   - TLS 서버이고 end 상태가 아니면 true 반환 → 재기동(stop→start) 스킵.
            //   - TLS off / 종료 / 미지원 시 false → 기존 stop/start 폴백.
            const hotSwapped = this._externalPortServerPool.applyTlsCertificateHotSwap(port, nextCert);
            if(hotSwapped) {
                logger.info(`applyExternalServerCert: hot-swapped TLS cert on port ${port} (no restart)`);
                return {
                    success: true,
                    partial: false,
                    warnings: [],
                    failedScopes: [],
                    restartRequiredScopes: []
                };
            }
            const stopped = await this._externalPortServerPool.stop(port);
            if(!stopped) {
                throw new Error(`failed to stop listener ${port}`);
            }
            await this._externalPortServerPool.startServer(currentOption, nextCert);
            await this.restoreExternalPortStatus(port, currentOption, lastServerStatus);
            return {
                success: true,
                partial: false,
                warnings: [],
                failedScopes: [],
                restartRequiredScopes: []
            };
        } catch (error) {
            logger.error(`applyExternalServerCert failed - port: ${port}`, error);
            try {
                await this._externalPortServerPool.startServer(currentOption, previousCert);
                await this.restoreExternalPortStatus(port, currentOption, lastServerStatus);
            } catch (restoreError) {
                logger.error(`applyExternalServerCert restore failed - port: ${port}`, restoreError);
            }
            return {
                success: false,
                partial: false,
                warnings: [],
                failedScopes: [`external-cert:${port}`],
                restartRequiredScopes: []
            };
        }
    }


    public async stopExternalPortServer(port: number) : Promise<boolean> {
        this._allowClientNamesMap.delete(port);
        this._allowClientIdsMap.delete(port);
        return await this._externalPortServerPool.stop(port);
    }

    public async activeExternalPortServer(port: number, timeout: number) : Promise<boolean> {
        return await this._externalPortServerPool.active(port, timeout);
    }

    public async inactiveExternalPortServer(port: number) : Promise<boolean> {
        return await this._externalPortServerPool.inactive(port);
    }




    public async updateAndRestartExternalPortServer(port: number) : Promise<boolean>  {
        let optionStore =  ServerOptionStore.instance;
        let tunnelOption = optionStore.getTunnelingOption(port);
        if(!tunnelOption) {
            return false;
        }
        this._allowClientNamesMap.delete(port);
        this._allowClientIdsMap.delete(port);
        if(tunnelOption.allowedClientIds && tunnelOption.allowedClientIds.length > 0) {
            this._allowClientIdsMap.set(port, tunnelOption.allowedClientIds);
        }
        if(tunnelOption.allowedClientNames && tunnelOption.allowedClientNames.length > 0) {
            this._allowClientNamesMap.set(port, tunnelOption.allowedClientNames);
        }
        let lastServerStatus = this._externalPortServerPool.getServerStatus(port);
        await this._externalPortServerPool.stop(port);
        let success = await this._externalPortServerPool.startServer(tunnelOption, CertificationStore.instance.getExternalCert(port));
        if(success && lastServerStatus && lastServerStatus.online) {
            this._externalPortServerPool.setActiveTimeout(port, lastServerStatus.activeTimeout);
            if(!tunnelOption.inactiveOnStartup)  await this._externalPortServerPool.active(port);

        }
        return success;
    }


    public async start() : Promise<void> {
        let optionStore =  ServerOptionStore.instance;
        let tunnelOptions =  optionStore.getTunnelingOptions();
        let certStore = CertificationStore.instance;
        for(let tunnelOption of tunnelOptions) {
            try {
                await this._externalPortServerPool.startServer(tunnelOption, certStore.getExternalCert(tunnelOption.forwardPort));
            } catch (err) {
                logger.error(`start - failed to start external port server. ${JSON.stringify(tunnelOption)}`,err);
            }
        }
        await this._tunnelServer.start();
    }

    public async close() : Promise<void> {
        await this._externalPortServerPool.stopAll();
        await this._tunnelServer.close();
    }

    public getClientSysInfo(clientID: number) : SysInfo | undefined {
        return this._tunnelServer.getClientSysInfo(clientID);
    }

    // P6-T1 개선 1회차 / REQ-09: 테스트/운영 진단용 TunnelServer 직접 접근.
    // 내부 맵 상태 검증(debugSessionCount)과 TTL 주입(configureSessionTtl) 경로에 사용.
    public get tunnelServer() : TunnelServer {
        return this._tunnelServer;
    }

}

export default TTTServer;

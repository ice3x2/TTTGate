import {ExternalPortServerPool, ExternalPortServerStatus } from "./ExternalPortServerPool";
import {TunnelServer, ClientStatus} from "./TunnelServer";
import {ServerOption, TunnelingOption} from "../option/TunnelingOption";
import SocketState from "../util/SocketState";
import {CertificationStore, CertInfo} from "./CertificationStore";
import ServerOptionStore from "./ServerOptionStore";
import {logger} from "../commons/Logger";


/**
  ExportPortServerPool은 외부에서 들어온 handler 만 관리한다.
  Ctrl 은 TunnelServer에서 관리한다.
 */

interface OnRequireCertificate {
    (callback: CertInfo): void;
}


class TTTServer {

    private _externalPortServerPool : ExternalPortServerPool;
    private _tunnelServer : TunnelServer;
    private _sessions : Set<number> = new Set<number>();
    private _allowClientNamesMap : Map<number, Array<string>> = new Map<number, Array<string>>();


    public static create(serverOption: ServerOption) : TTTServer {
        return new TTTServer(serverOption);
    }

    private constructor(serverOption: ServerOption) {
        if(serverOption.tls == undefined) serverOption.tls = false;
        this._externalPortServerPool = ExternalPortServerPool.create(serverOption.tunnelingOptions);
        let tempCert = CertificationStore.instance.getTempCert();
        this._tunnelServer = TunnelServer.create({port: serverOption.port,key: serverOption.key,tls: serverOption.tls}, tempCert);
        this._externalPortServerPool.setOnHandlerEventCallback(this.onHandlerEventOnExternalPortServer)
        this._externalPortServerPool.setOnNewSessionCallback(this.onNewSession);
        this._tunnelServer.onSessionCloseCallback = this.onSessionClosed;
        this._tunnelServer.onReceiveDataCallback = this.onSessionDataReceived;
        serverOption.tunnelingOptions.forEach((option) => {
            if(option.allowedClientNames && option.allowedClientNames.length > 0) {
                this._allowClientNamesMap.set(option.forwardPort, option.allowedClientNames!);
            }
        });


    }

    private onNewSession = (id: number, opt: TunnelingOption) : void => {

        let bufferLimitOnClient = opt.bufferLimitOnClient == undefined || opt.bufferLimitOnClient < 1 ? -1 : opt.bufferLimitOnClient! * 1024 * 1024;
        this._sessions.add(id);
        let allowClientNames = this._allowClientNamesMap.get(opt.forwardPort);
        let success = this._tunnelServer.open(id, {host: opt.destinationAddress,port: opt.destinationPort!,tls: opt.tls,bufferLimit: bufferLimitOnClient},allowClientNames);
        if(!success) {
            this._sessions.delete(id);
            this._externalPortServerPool.closeSession(id);
        }
    }


    private onHandlerEventOnExternalPortServer = (id: number, state: SocketState, data? : Buffer) : void => {
        if(this.isEndState(state)) {
            this._tunnelServer.closeSession(id);
        } else if(state == SocketState.Receive && data) {
            if (!this._tunnelServer.sendBuffer(id, data)) {
                this._externalPortServerPool.closeSession(id);
            }
        }

    }

    private onSessionClosed = (id: number) : void => {
        this._externalPortServerPool.closeSession(id);
    }

    private onSessionDataReceived = (id: number, data: Buffer) : void => {
        if(!this._externalPortServerPool.send(id, data)) {
            this._tunnelServer.closeSession(id);
        }
    }


    private isEndState (state: SocketState) : boolean  {
        return state == SocketState.Closed || state == SocketState.End || state == SocketState.Error;
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


    public async stopExternalPortServer(port: number) : Promise<boolean> {
        this._allowClientNamesMap.delete(port);
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
                logger.error(`TTTServer::start - failed to start external port server. ${JSON.stringify(tunnelOption)}`);
                logger.error(err);
            }
        }
        await this._tunnelServer.start();
    }

    public async close() : Promise<void> {
        await this._externalPortServerPool.stopAll();
        await this._tunnelServer.close();
    }

}

export default TTTServer;
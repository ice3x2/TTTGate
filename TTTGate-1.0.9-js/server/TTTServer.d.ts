import { ExternalPortServerStatus } from "./ExternalPortServerPool";
import { ClientStatus } from "./TunnelServer";
import { ServerOption } from "../types/TunnelingOption";
import { SysInfo } from "../commons/SysMonitor";
/**
  ExportPortServerPool은 외부에서 들어온 handler 만 관리한다.
  Ctrl 은 TunnelServer에서 관리한다.
 */
declare class TTTServer {
    private _externalPortServerPool;
    private _tunnelServer;
    private _sessions;
    private _allowClientNamesMap;
    static create(serverOption: ServerOption): TTTServer;
    private constructor();
    private onNewSession;
    private OnTerminateSession;
    private onHandlerEventOnExternalPortServer;
    private onSessionClosed;
    private onSessionDataReceived;
    private isEndState;
    externalServerStatuses(): Array<ExternalPortServerStatus>;
    externalServerStatus(port: number): ExternalPortServerStatus;
    clientStatus(): Array<ClientStatus>;
    stopExternalPortServer(port: number): Promise<boolean>;
    activeExternalPortServer(port: number, timeout: number): Promise<boolean>;
    inactiveExternalPortServer(port: number): Promise<boolean>;
    updateAndRestartExternalPortServer(port: number): Promise<boolean>;
    start(): Promise<void>;
    close(): Promise<void>;
    getClientSysInfo(clientID: number): SysInfo | undefined;
}
export default TTTServer;

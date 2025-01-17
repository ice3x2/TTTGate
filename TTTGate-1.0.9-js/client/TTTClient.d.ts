import { ClientOption } from "../types/TunnelingOption";
declare class TTTClient {
    private readonly _clientOption;
    private _endPointClientPool;
    private _tunnelClient;
    private _tryConnectState;
    private _isOnline;
    private constructor();
    static create(clientOption: ClientOption): TTTClient;
    start(): void;
    private onCtrlStateCallback;
    private onSessionOpenCallback;
    private onSessionCloseCallback;
    private onSessionSendCallback;
    private onEndPointTerminateCallback;
    private onEndPointClientStateChangeCallback;
}
export default TTTClient;

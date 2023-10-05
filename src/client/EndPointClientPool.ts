import {SocketHandler} from "../util/SocketHandler";
import ConnectOpt from "../util/ConnectOpt";
import SocketState from "../util/SocketState";
import {Buffer} from "buffer";
import {OpenOpt} from "../commons/CtrlPacket";


const ID_BUNDLE_KEY : string = "i";

interface OnEndPointClientStateChangeCallback {
    (id: number, state: number, data? : any) : void;
}

class EndPointClientPool {

    private _connectOptMap: Map<number, ConnectOpt> = new Map<number, ConnectOpt>();
    private _endPointClientMap: Map<number, SocketHandler> = new Map<number, SocketHandler>();
    private _onEndPointClientStateChangeCallback: OnEndPointClientStateChangeCallback | null = null;


    public constructor() {

    }

    public set onEndPointClientStateChangeCallback(callback: OnEndPointClientStateChangeCallback) {
        this._onEndPointClientStateChangeCallback = callback;
    }


    public open(sessionID: number, connectOpt: OpenOpt) {

        this._connectOptMap.set(sessionID, connectOpt);
        console.log("엔드포인트 연결 시도: sessionID:" + sessionID + "    " + connectOpt.host + ":" + connectOpt.port);
        let endPointClient = SocketHandler.connect(connectOpt,( client: SocketHandler, state: SocketState, data?: any) => {
            client.setBufferSizeLimit(connectOpt.bufferLimit);
            this.onEndPointClientStateChange(sessionID, client, state, data);
        });
        this._endPointClientMap.set(sessionID, endPointClient);

    }

    public close(id: number) : boolean {
        let endPointClient = this._endPointClientMap.get(id);
        if(endPointClient) {
            endPointClient.onSocketEvent = function (){};
            endPointClient.end();
            return this._endPointClientMap.delete(id);
        }
        return false;
    }






    public send(id: number, data: Buffer) {
        let endPointClient = this._endPointClientMap.get(id);
        if(endPointClient) {
            endPointClient.sendData(data);
        }
    }


    private onEndPointClientStateChange = (sessionID: number, client: SocketHandler, state: SocketState, data? :any) : void => {
        if(!client.hasBundle(ID_BUNDLE_KEY)) {
            client.setBundle(ID_BUNDLE_KEY, sessionID);
        }
        if(this._connectOptMap.has(sessionID)) {
            // 임시 조건문
            if(state == SocketState.Connected) {
                console.log("엔드포인트 연결 성공!: sessionID:" + sessionID + "    ");
            }
            this._onEndPointClientStateChangeCallback?.(sessionID,state,data);
            if(!this._endPointClientMap.has(sessionID)) {
                this._endPointClientMap.set(sessionID, client);
            }
        } else {
            client.end();
        }
        if(SocketState.End == state || SocketState.Closed == state /*|| SocketState.Error == state*/) {
            this._endPointClientMap.delete(sessionID);
            this._connectOptMap.delete(sessionID);
        }
    }



    public closeAll() {
        this._onEndPointClientStateChangeCallback = null;
        this._endPointClientMap.forEach((client: SocketHandler, key: number) => {
            client.destroy();
        });
        this._endPointClientMap.clear();
    }




}

export default EndPointClientPool;
import SocketHandler from "../util/SocketHandler";
import {ConnectOpt} from "../option/ConnectOpt";
import SocketState from "../util/SocketState";
import {Buffer} from "buffer";


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

    public open(id: number, connectOpt: ConnectOpt ) {
        this._connectOptMap.set(id, connectOpt);
        let endPointClient = SocketHandler.connect(connectOpt,( client: SocketHandler, state: SocketState, data?: any) => {
            this.onEndPointClientStateChange(id, client, state, data);
        });
        this._endPointClientMap.set(id, endPointClient);

    }

    public close(id: number) : boolean {
        let endPointClient = this._endPointClientMap.get(id);
        if(endPointClient) {
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


    private onEndPointClientStateChange = (id: number, client: SocketHandler, state: SocketState, data? :any) : void => {
        if(!client.hasBundle(ID_BUNDLE_KEY)) {
            client.setBundle(ID_BUNDLE_KEY, id);
        }
        if(this._connectOptMap.has(id)) {
            this._onEndPointClientStateChangeCallback?.(id,state,data);
            if(!this._endPointClientMap.has(id)) {
                this._endPointClientMap.set(id, client);
            }
        }
        if(SocketState.End == state || SocketState.Closed == state || SocketState.Error == state) {
            this._endPointClientMap.delete(id);
            this._connectOptMap.delete(id);
        }
    }



    public closeAll() {
        this._onEndPointClientStateChangeCallback = null;
        this._endPointClientMap.forEach((client: SocketHandler, key: number) => {
            client.close();
        });
        this._endPointClientMap.clear();
    }




}

export default EndPointClientPool;
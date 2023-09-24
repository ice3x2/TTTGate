import SessionState from "../option/SessionState";
import Session from "./Session";
import {CtrlPacket, CtrlPacketStreamer} from "./CtrlPacket";


class ControlSession extends Session {


    private _clientName : string = "";
    private _address : string = "";
    public static createControlSession(id: number) : ControlSession {
        console.log("[server]",`ControlSession: create: ${id}`);
        let session = new ControlSession(id);
        session.state = SessionState.HalfOpened;
        return session;
    }

    public get clientName() : string {
        return this._clientName;
    }

    public set clientName(name: string) {
        this._clientName = name;
    }

    public get address() : string {
        return this._address;
    }
    public set address(address: string) {
        this._address = address;
    }

    constructor(id: number) {
        super(id);
    }





}

export default ControlSession;
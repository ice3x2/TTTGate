import SessionState from "../option/SessionState";
import Session from "./Session";
import {CtrlPacket, CtrlPacketStreamer} from "./CtrlPacket";


class ControlSession extends Session {

    // @ts-ignore
    private readonly _packetStream : CtrlPacketStreamer = new CtrlPacketStreamer();
    private _clientName : string = "";
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

    constructor(id: number) {
        super(id);
    }

    /**
     *
     * @param buffer
     * @returns CtrlPacket list. 만약 buffer에 여러개의 패킷이 들어있다면 여러개의 패킷을 반환한다. 아닐경우 빈 리스트를 반한한다.
     */
    public readCtrlPacketList(buffer: Buffer) : Array<CtrlPacket>{
        return this._packetStream.readCtrlPacketList(buffer);
    }



}

export default ControlSession;
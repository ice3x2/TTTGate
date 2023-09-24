import SessionState from "../option/SessionState";
import Dequeue from "../util/Dequeue";
import {Buffer} from "buffer";
import {CtrlPacket, CtrlPacketStreamer} from "./CtrlPacket";

class Session {
    public readonly id : number;
    public state: SessionState = SessionState.None;
    private _createTime: number = Date.now();
    private readonly _packetStream : CtrlPacketStreamer = new CtrlPacketStreamer();

    public get createTime() : number {
        return this._createTime;
    }


    private readonly _sendBufferOnWaitConnected : Dequeue<Buffer> = new Dequeue<Buffer>();

    constructor(id: number) {
        this.id = id;
    }


    public isConnected() : boolean {
        return this.state == SessionState.Connected;
    }

    public isEnd() : boolean {
        return this.state == SessionState.Closed;
    }

    public pushWaitBuffer(buffer: Buffer) : void {
        //console.log("[server]",`ControlSession: pushWaitBuffer: ${this.id}, length: ${buffer.length}`)
        this._sendBufferOnWaitConnected.pushBack(buffer);
    }

    public popWaitBuffer() : Buffer | undefined {

        let buffer =  this._sendBufferOnWaitConnected.popFront();
        //console.log("[server]",`ControlSession: popWaitBuffer: ${this.id}, length: ${buffer ? buffer.length : 0}`)
        return buffer;
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

export default Session;
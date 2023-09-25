import SessionState from "../option/SessionState";
import Dequeue from "../util/Dequeue";
import {Buffer} from "buffer";
import {CtrlPacket, CtrlPacketStreamer} from "./CtrlPacket";

class Session {

    private readonly _id : number;
    private _state: SessionState = SessionState.None;
    private _createTime: number = Date.now();
    private readonly _sendBufferOnWaitConnected : Dequeue<Buffer> = new Dequeue<Buffer>();


    public get createTime() : number {
        return this._createTime;
    }

    constructor(id: number) {
        this._id = id;
    }

    public get id() : number {
        return this._id;
    }

    public get state() : SessionState {
        return this._state;
    }


    public isConnected() : boolean {
        return this._state == SessionState.Connected;
    }

    public isEnd() : boolean {
        return this._state == SessionState.Closed;
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


}

export default Session;
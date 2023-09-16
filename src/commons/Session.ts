import SessionState from "../option/SessionState";
import Dequeue from "../util/Dequeue";
import {Buffer} from "buffer";

class Session {
    public readonly id : number;
    public state: SessionState = SessionState.None;
    private _createTime: number = Date.now();

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
        return this.state == SessionState.Closed || this.state == SessionState.End;
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
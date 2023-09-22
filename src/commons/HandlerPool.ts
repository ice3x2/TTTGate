import {SocketHandler} from "../util/SocketHandler";
import {CtrlPacket, OpenOpt} from "./CtrlPacket";


class HandlerPool {

    private readonly _id : number;
    private readonly _controlHandler: SocketHandler;
    private _name : string = '';
    private _waitDataHandlerPool: Array<SocketHandler> = new Array<SocketHandler>();
    private _openedHandlerMap : Map<number, SocketHandler> = new Map<number, SocketHandler>();


    public static create(id : number, controlHandler: SocketHandler) : HandlerPool {
        return new HandlerPool(id, controlHandler);
    }

    private constructor(id : number, controlHandler: SocketHandler) {
        this._id = id;
        this._controlHandler = controlHandler;
    }

    private set name(name: string) {
        this._name = name;
    }

    public get id() : number {
        return this._id;
    }

    public get name() : string {
        return this._name;
    }

    public open(sessionID: number, opt : OpenOpt) : void {
        let socketHandler = this.obtainWaitDataHandler();
        if(socketHandler == undefined) {

        }

    }

    public send(sessionID: number, data: Buffer) : void {

    }

    public close(sessionID: number) : void {

    }

    public endAll() : void {

    }


    private obtainWaitDataHandler() : SocketHandler | undefined {
        if(this._waitDataHandlerPool.length > 0) {
            return this._waitDataHandlerPool.shift();
        }
        return undefined;
    }

    private pushWaitDataHandler(handler: SocketHandler) : void {
        this._waitDataHandlerPool.push(handler);
    }

    private sendNewDataHandlerAndOpen(sessionId: number) : void {
        CtrlPacket.


    }
}
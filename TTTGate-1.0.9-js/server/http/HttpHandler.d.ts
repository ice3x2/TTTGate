/// <reference types="node" />
import { SocketHandler } from "../../util/SocketHandler";
import { TunnelingOption } from "../../types/TunnelingOption";
import SocketState from "../../util/SocketState";
interface OnSocketEvent {
    (handler: HttpHandler, state: SocketState, data?: any): void;
}
declare class HttpHandler {
    private readonly _socketHandler;
    private _currentHttpPipe;
    private _isUpgrade;
    private _originHost;
    private _httpMessageType;
    private _currentHttpHeader;
    private _event;
    private _isReplaceHostInBody;
    private _bodyBuffer;
    private _originAddress;
    private _destinationAddress;
    private _option;
    private _receiveLength;
    private _bufLength;
    private _sendLength;
    private _leftBufferStateInEnd;
    set onSocketEvent(event: OnSocketEvent);
    get receiveLength(): number;
    get sendLength(): number;
    static create(socketHandler: SocketHandler, tunnelOption: TunnelingOption): HttpHandler;
    get id(): number;
    setBundle(key: string, value: any): void;
    getBundle(key: string): any;
    deleteBundle(key: string): void;
    private constructor();
    private onSocketEventFromSocketHandler;
    private onHttpHeader;
    get breakBufferFlush(): boolean;
    private manipulateRequestHeader;
    private callEvent;
    private manipulateResponseHeader;
    private appendCustomHeader;
    private replaceLocationInResponseHeaderAt3XX;
    private changeModeOfReplaceHostInBodyInResponseHeader;
    private removeDomainInSetCookie;
    private replaceHostInHeader;
    private findHostFromHeader;
    private onHttpBody;
    private onHttpMessageEnd;
    private onHttpMessageError;
    sendData(data: Buffer): void;
    end_(): void;
    destroy(): void;
    private release;
    private replaceAndSendHostInBody;
    private modifyBodyByRule;
    private createRegExp;
    private modifyUrlsInBody;
}
export default HttpHandler;

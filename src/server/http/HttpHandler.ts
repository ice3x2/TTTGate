import {SocketHandler} from "../../util/SocketHandler";
import {CustomHeader, HttpOption, TunnelingOption} from "../../types/TunnelingOption";
import {HttpHeader, HttpPipe, HttpRequestHeader, HttpResponseHeader, MessageType} from "./HttpPipe";
import HttpUtil from "./HttpUtil";
import httpUtil from "./HttpUtil";
import SocketState from "../../util/SocketState";

import LoggerFactory  from "../../util/logger/LoggerFactory";
let logger = LoggerFactory.getLogger('server', 'HttpHandler');

interface OnSocketEvent {
    (handler: HttpHandler, state: SocketState, data?: any) : void;
}


const CHUNK_SIZE : number = 1024;

// noinspection JSUnusedGlobalSymbols
class HttpHandler {

    private readonly _socketHandler : SocketHandler;
    private _currentHttpPipe : HttpPipe = new HttpPipe();
    private _isUpgrade : boolean = false;
    private _originHost : string = "";
    private _httpMessageType : MessageType = MessageType.Request;
    private _currentHttpHeader : HttpRequestHeader | HttpResponseHeader | null = null;
    private _event : OnSocketEvent | null = null;

    private _isReplaceHostInBody : boolean = false;
    private _bodyBuffer : Buffer = Buffer.alloc(0);
    private _originAddress: string = "";

    private _destinationAddress : string = "";
    private _option : HttpOption = {}

    private _receiveLength: number = 0;
    private _bufLength: number = 0;
    private _sendLength: number = 0;

    private _leftBufferStateInEnd : boolean = false;

    public set onSocketEvent(event: OnSocketEvent) {
        this._event = event;
    }

    public get receiveLength() : number {
        return this._receiveLength;
    }

    public get sendLength() : number {
        return this._sendLength;
    }

    public static create(socketHandler: SocketHandler,tunnelOption: TunnelingOption) : HttpHandler {
        let handler = new HttpHandler(socketHandler);
        handler._option = !tunnelOption.httpOption ? handler._option : tunnelOption.httpOption!;

        if(handler._option.rewriteHostInTextBody == undefined) {
            handler._option.rewriteHostInTextBody = true;
        }
        if(handler._option.replaceAccessControlAllowOrigin == undefined) {
            handler._option.replaceAccessControlAllowOrigin = true;
        }

        handler._destinationAddress = tunnelOption.destinationAddress;
        return handler;
    }

    public get id() : number {
        return this._socketHandler.id;
    }


    public setBundle(key: string, value: any) {
        this._socketHandler.setBundle(key, value);
    }

    public getBundle(key: string) : any {``
        return this._socketHandler.getBundle(key);
    }

    public deleteBundle(key: string) : void {
        this._socketHandler.deleteBundle(key);
    }


    private constructor(socketHandler: SocketHandler) {
        this._socketHandler = socketHandler;
        socketHandler.onSocketEvent = this.onSocketEventFromSocketHandler;
        this._currentHttpPipe.onHeaderCallback = this.onHttpHeader;
        this._currentHttpPipe.onDataCallback = this.onHttpBody;
        this._currentHttpPipe.onEndCallback = this.onHttpMessageEnd;
        this._currentHttpPipe.onErrorCallback = this.onHttpMessageError;
    }

    private onSocketEventFromSocketHandler = (handler: SocketHandler, state: SocketState, data?: any) : void => {

        if(state == SocketState.Receive && !this._socketHandler.isEnd()) {
            if(this._isUpgrade) {
                this.callEvent(SocketState.Receive, data)
                return;
            }
            if(this._currentHttpPipe.messageType == MessageType.Response) {
                this._currentHttpPipe.reset(MessageType.Request);
            }
            this._currentHttpPipe.write(data);
        } else {
            if(this._socketHandler.isEnd() || SocketState.End == state || /*SocketState.Error == state ||*/ SocketState.Closed == state) {
                this._leftBufferStateInEnd = this._currentHttpPipe.bufferSize > 0;
                this._sendLength = this._bufLength;
                this.release();
            }
            this.callEvent(state);
            if(state == SocketState.Closed) {
                this._event = null;
            }
        }
    }


    private onHttpHeader = (header: HttpRequestHeader | HttpResponseHeader) : void => {
        this._currentHttpHeader = header;
        if(header.type == MessageType.Request) {
            this.manipulateRequestHeader(<HttpRequestHeader>header);
        } else if(header.type == MessageType.Response) {

            this.manipulateResponseHeader(<HttpResponseHeader>header);
        }
    }

    public get breakBufferFlush() : boolean {
        return this._socketHandler.breakBufferFlush || this._leftBufferStateInEnd;
    }

    private manipulateRequestHeader(header: HttpRequestHeader) : void {
        this._originAddress = "";
        this._originHost = this.findHostFromHeader(header);
        if(this._originHost != "") {
            this.replaceHostInHeader(header, this._originHost, this._destinationAddress);
            let requestHeader = header;
            requestHeader.path = requestHeader.path.replaceAll(this._originHost, this._destinationAddress);
        }
        let origin = HttpUtil.findHeaderValue(header, "Origin");
        if(origin != null) {
            this._originAddress = origin;
        }
        this.appendCustomHeader(header, this._option.customRequestHeaders);
        let headerBuffer = HttpUtil.convertHttpHeaderToBuffer(header);
        this.callEvent(SocketState.Receive, headerBuffer)
    }

    private callEvent(state: SocketState, data?: any) : void {
        if(data) {
            this._receiveLength += Buffer.byteLength(data);
        }


        this._event?.(this, state, data);

    }



    private manipulateResponseHeader(header: HttpResponseHeader) : void {
        this._isUpgrade = header.upgrade;

        let host = this.findHostFromHeader(header);
        if(host != "" && this._originHost != "") {
            this.replaceHostInHeader(header, host, this._originHost);
        }
        this.appendCustomHeader(header, this._option.customResponseHeaders);
        this.replaceLocationInResponseHeaderAt3XX(header);
        this.removeDomainInSetCookie(<HttpResponseHeader>header);
        this._isReplaceHostInBody = this._option.rewriteHostInTextBody == true && HttpUtil.isTextContentType(header) && (header.contentLength > 0 || header.chunked);
        this.changeModeOfReplaceHostInBodyInResponseHeader(header);
        if(this._option.replaceAccessControlAllowOrigin == true) {
            HttpUtil.removeHeader(header, "Access-Control-Allow-Origin");
            if(this._originAddress != "") {
                header.headers.push({name: "Access-Control-Allow-Origin", value: this._originAddress});
            } else {
                let protocol : string = this._socketHandler.isSecure() ? "https://" : "http://";
                header.headers.push({name: "Access-Control-Allow-Origin", value: protocol +  this._originHost});
            }
        }
        let headerBuffer = HttpUtil.convertHttpHeaderToBuffer(header);
        this._socketHandler.sendData(headerBuffer, (client, success) => {
            if(success) {
                this._sendLength = this._bufLength;
            }
        });
    }



    private appendCustomHeader(header: HttpHeader,userHeaders?: Array<CustomHeader> ) : void {
        if(!userHeaders) {
            return;
        }
        userHeaders.forEach((nameValue) => {
            if(nameValue.replace) {
                HttpUtil.removeHeader(header, nameValue.name);
            }
            header.headers.push(nameValue);
        });
    }

    private replaceLocationInResponseHeaderAt3XX(header: HttpResponseHeader) : void {
        let httpStatus = (<HttpResponseHeader>header).status;
        if(httpStatus >= 300 && httpStatus < 400) {
            header.headers.find((nameValue) => {
                if (nameValue.name.toLowerCase() == "location") {
                    nameValue.value = nameValue.value.replace(this._destinationAddress, this._originHost);
                    return true;
                }
                return false;
            });
        }
    }


    private changeModeOfReplaceHostInBodyInResponseHeader(header: HttpResponseHeader) : void {
        this._currentHttpPipe.setDeliverPureData(this._isReplaceHostInBody);
        if(this._isReplaceHostInBody) {
            HttpUtil.removeHeader(header, "Content-Length");
            httpUtil.removeHeader(header, "Transfer-Encoding");
            header.headers.push({name: "Transfer-Encoding", value: "chunked"});
        }
    }


    private removeDomainInSetCookie(header: HttpResponseHeader) : void {
        let setCookies = HttpUtil.findHeaders(header, "Set-Cookie");
        for(let setCookie of setCookies) {
            setCookie.value = setCookie.value.replace(/Domain=[^;]+;/ig, "");
        }

    }

    private replaceHostInHeader(header: HttpHeader, host: string, replaceHost : string) : void {
        for(let nameValue of header.headers) {
            if(nameValue.value.indexOf(host) > -1) {
                nameValue.value = nameValue.value.replace(host,replaceHost);
            }
        }
    }

    private findHostFromHeader(header: HttpRequestHeader | HttpResponseHeader, name : string  = "Host") : string {
        let nameValue = HttpUtil.findHeader(header, name);
        if(nameValue != null) {
            return nameValue.value;
        }
        return "";
    }

    private onHttpBody = (data: Buffer) : boolean => {
        if(this._socketHandler.isEnd()) {
            return false;
        }
        if(this._isReplaceHostInBody) {
            this._bodyBuffer = Buffer.concat([this._bodyBuffer, data]);
        }
        else if(this._httpMessageType == MessageType.Request) {
            this.callEvent(SocketState.Receive, data);
        } else {
            this._socketHandler.sendData(data, (client, success) => {
                if(success) {
                    this._sendLength = this._bufLength;
                }
            });
        }
        return true;
    }




    private onHttpMessageEnd = () : void => {
        if(this._isReplaceHostInBody) {
            this.replaceAndSendHostInBody();

        }

        if(this._httpMessageType == MessageType.Request) {
            this._currentHttpPipe.reset(MessageType.Response);
            this._httpMessageType = MessageType.Response;
        } else {
            this._currentHttpPipe.reset(MessageType.Request);
            this._httpMessageType = MessageType.Request;
        }

    }

    private onHttpMessageError = (error: Error) : void => {
        this._bodyBuffer = Buffer.alloc(0);
        this._isReplaceHostInBody = false;
        this._httpMessageType = MessageType.Request;
        this._currentHttpPipe.reset(MessageType.Request);
        logger.error('HTTP Message parse Error', error);
        this._socketHandler.destroy();
    }



    public sendData(data: Buffer) : void {
        if(this._socketHandler.isEnd()) {
            return;
        }
        if(this._isUpgrade) {
            this._bufLength += data.length;
            this._socketHandler.sendData(data, (client, success) => {
                if(success) {
                    this._sendLength = this._bufLength;
                }
            });
            return;
        }
        if(this._httpMessageType == MessageType.Request) {
            this._currentHttpPipe.reset(MessageType.Response);
            this._httpMessageType = MessageType.Response;
        }
        this._bufLength += data.length;
        this._currentHttpPipe.write(data);


    }

    public end_() : void {
        this.release();
        this._socketHandler.end_();
    }

    public destroy() : void {
        this.release();
        this._socketHandler.destroy();
    }

    private release() : void {
        this._currentHttpPipe.reset(MessageType.Request);
        this._httpMessageType = MessageType.Request;
        this._isUpgrade = false;
    }


    private replaceAndSendHostInBody()  {
        let encoding = HttpUtil.findHeaderValue(this._currentHttpHeader!, "Content-Encoding");
        this._bodyBuffer = HttpUtil.uncompressBody(encoding, this._bodyBuffer);
        let body = this._bodyBuffer.toString();
        body = this.modifyUrlsInBody(body, this._destinationAddress, this._originHost);
        body = this.modifyBodyByRule(body);
        this._bodyBuffer = Buffer.from(body);
        this._bodyBuffer = HttpUtil.compressBody(encoding, this._bodyBuffer);

        // this._bodyBuffer 를 1024byte 씩 끊어서 보내야함
        let bodyBuffer = this._bodyBuffer;
        while(bodyBuffer.length > 0) {
            let sendBuffer = bodyBuffer.subarray(0, Math.min(CHUNK_SIZE, bodyBuffer.length));
            bodyBuffer = bodyBuffer.subarray(sendBuffer.length);
            this._socketHandler.sendData(Buffer.from(sendBuffer.length.toString(16) + "\r\n"));
            this._socketHandler.sendData(sendBuffer);
            this._socketHandler.sendData(Buffer.from("\r\n"));

        }
        this._socketHandler.sendData(Buffer.from("0\r\n\r\n"),(client, success) => {
            if(success) {
                this._sendLength = this._bufLength;
            }
        });
        this._currentHttpHeader = null;
        this._bodyBuffer = Buffer.alloc(0);
        this._isReplaceHostInBody = false;
    }

    private modifyBodyByRule(body: string) : string {
        let rules = this._option.bodyRewriteRules;
        if(!rules) {
            return body;
        }
        for(let rule of rules) {
            let regx = this.createRegExp(rule.from);
            body = body.replaceAll(regx, rule.to);
        }
        return body;
    }

    private createRegExp(pattern: string): RegExp | string {
        const regexPattern = /^\/(.+)\/([gim]*)$/; // 정규식 패턴 검사용 정규식
        const match = pattern.match(regexPattern);
        if (match) {
            try {
                const [, patternStr, flags] = match;
                return new RegExp(patternStr, flags);
            } catch (error) {
                logger.error('Error creating RegExp:' + pattern, error)
                return pattern; // 잘못된 정규식 패턴일 경우 그대로 문자열 반환
            }
        } else {
            return pattern;
        }
    }

    private modifyUrlsInBody(body: string, originHost: string, host: string): string {
        const httpUrlPattern = /:\/\/[^\s'"]+/gi;
        return body.replace(httpUrlPattern, url => {
            let newUrl = url.replace(/:\/\//i, "");
            if (!newUrl.startsWith(originHost)) {
                return url;
            }
            newUrl = "://" + newUrl.replace(originHost, host);
            return newUrl;
        });
    }


}

export default HttpHandler;
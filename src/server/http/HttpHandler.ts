import {SocketHandler} from "../../util/SocketHandler";
import {CustomHeader, HttpOption, TunnelingOption} from "../../types/TunnelingOption";
import {HttpHeader, HttpPipe, HttpRequestHeader, HttpResponseHeader, MessageType, ParseState} from "./HttpPipe";
import HttpUtil from "./HttpUtil";
import SocketState from "../../util/SocketState";

import LoggerFactory from "../../util/logger/LoggerFactory";
let logger = LoggerFactory.getLogger('server', 'HttpHandler');

interface OnSocketEvent {
    (handler: HttpHandler, state: SocketState, data?: any): void;
}

// 청크 데이터 처리 크기
const CHUNK_SIZE: number = 8 * 1024; // 8KB로 증가
const MAX_BUFFER_SIZE: number = 16 * 1024 * 1024; // 16MB

class HttpHandler {
    private readonly _socketHandler: SocketHandler;
    private _currentHttpPipe: HttpPipe = new HttpPipe();
    private _isUpgrade: boolean = false;
    private _originHost: string = "";
    private _httpMessageType: MessageType = MessageType.Request;
    private _currentHttpHeader: HttpRequestHeader | HttpResponseHeader | null = null;
    private _event: OnSocketEvent | null = null;

    private _isReplaceHostInBody: boolean = false;
    private _bodyBuffer: Buffer = Buffer.alloc(0);
    private _originAddress: string = "";

    private _destinationAddress: string = "";
    private _option: HttpOption = {}

    private _receiveLength: number = 0;
    private _bufLength: number = 0;
    private _sendLength: number = 0;

    private _leftBufferStateInEnd: boolean = false;
    private _isWebSocket: boolean = false;
    private _keepAlive: boolean = false;

    public set onSocketEvent(event: OnSocketEvent) {
        this._event = event;
    }

    public get receiveLength(): number {
        return this._receiveLength;
    }

    public get sendLength(): number {
        return this._sendLength;
    }

    public get isWebSocket(): boolean {
        return this._isWebSocket;
    }

    public get keepAlive(): boolean {
        return this._keepAlive;
    }

    public static create(socketHandler: SocketHandler, tunnelOption: TunnelingOption): HttpHandler {
        let handler = new HttpHandler(socketHandler);
        handler._option = !tunnelOption.httpOption ? handler._option : tunnelOption.httpOption!;

        if (handler._option.rewriteHostInTextBody == undefined) {
            handler._option.rewriteHostInTextBody = true;
        }
        if (handler._option.replaceAccessControlAllowOrigin == undefined) {
            handler._option.replaceAccessControlAllowOrigin = true;
        }

        handler._destinationAddress = tunnelOption.destinationAddress;
        return handler;
    }

    public get id(): number {
        return this._socketHandler.id;
    }

    public setBundle(key: string, value: any) {
        this._socketHandler.setBundle(key, value);
    }

    public getBundle(key: string): any {
        return this._socketHandler.getBundle(key);
    }

    public deleteBundle(key: string): void {
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

    private onSocketEventFromSocketHandler = (handler: SocketHandler, state: SocketState, data?: any): void => {
        if (state == SocketState.Receive && !this._socketHandler.isEnd()) {
            if (this._isUpgrade || this._isWebSocket) {
                // 웹소켓이나 다른 프로토콜로 업그레이드된 경우
                this.callEvent(SocketState.Receive, data);
                return;
            }
            
            // Content-Length가 너무 크거나 Chunked 데이터가 너무 크면 오류 발생
            if (this._bodyBuffer.length > MAX_BUFFER_SIZE) {
                logger.error(`Buffer size exceeded maximum allowed size: ${this._bodyBuffer.length} > ${MAX_BUFFER_SIZE}`);
                this._socketHandler.destroy();
                return;
            }
            
            // 새로운 HTTP 메시지를 시작할 때 파이프 초기화
            if (this._currentHttpPipe.messageType == MessageType.Response && 
                (this._currentHttpPipe as any)._state === ParseState.END) {
                this._currentHttpPipe.reset(MessageType.Request);
                this._httpMessageType = MessageType.Request;
            }
            
            this._currentHttpPipe.write(data);
        } else {
            if(this._isWebSocket) {
                return;
            }


            if (this._socketHandler.isEnd() || SocketState.End == state || SocketState.Closed == state) {
                this._leftBufferStateInEnd = this._currentHttpPipe.bufferSize > 0;
                this._sendLength = this._bufLength;
                this.release();
            }
            this.callEvent(state);
            if (state == SocketState.Closed) {
                this._event = null;
            }
        }
    }

    private onHttpHeader = (header: HttpRequestHeader | HttpResponseHeader): void => {
        this._currentHttpHeader = header;
        
        // Keep-Alive 처리
        if (header.keepAlive) {
            this._keepAlive = true;
            
            // 타임아웃 설정
            if (this._option.keepAliveTimeout) {
                this._socketHandler.setTimeout(this._option.keepAliveTimeout * 1000);
            } else {
                // 기본 Keep-Alive 타임아웃 (60초)
                this._socketHandler.setTimeout(60000);
            }
        } else {
            this._keepAlive = false;
        }
        
        if (header.type == MessageType.Request) {
            this.manipulateRequestHeader(<HttpRequestHeader>header);
        } else if (header.type == MessageType.Response) {
            this.manipulateResponseHeader(<HttpResponseHeader>header);
        }
    }

    public get breakBufferFlush(): boolean {
        return this._socketHandler.breakBufferFlush || this._leftBufferStateInEnd;
    }

    private manipulateRequestHeader(header: HttpRequestHeader): void {
        this._originAddress = "";
        this._originHost = this.findHostFromHeader(header);

        // 웹소켓 요청인지 확인
        this.checkWebSocketUpgrade(header);

        if (this._originHost != "") {
            this.replaceHostInHeader(header, this._originHost, this._destinationAddress);
            let requestHeader = header;

            // 웹소켓 URL 처리
            if (this._isWebSocket) {
                // WebSocket URL을 HTTP URL로 변환해서 처리할 필요가 있다면
                if (requestHeader.path.startsWith('ws://') || requestHeader.path.startsWith('wss://')) {
                    const httpUrl = HttpUtil.wsUrlToHttpUrl(requestHeader.path);
                    logger.info(`Converting WebSocket URL: ${requestHeader.path} -> ${httpUrl}`);
                    requestHeader.path = httpUrl;
                }
            }

            requestHeader.path = requestHeader.path.replaceAll(this._originHost, this._destinationAddress);
        }

        let origin = HttpUtil.findHeaderValue(header, "Origin");
        if (origin != null) {
            this._originAddress = origin;
        }

        this.appendCustomHeader(header, this._option.customRequestHeaders);
        let headerBuffer = HttpUtil.convertHttpHeaderToBuffer(header);
        this.callEvent(SocketState.Receive, headerBuffer)
    }

    private checkWebSocketUpgrade(header: HttpRequestHeader): void {
        // Connection과 Upgrade 헤더 값 가져오기
        const connection = HttpUtil.findHeaderValue(header, "Connection");
        const upgrade = HttpUtil.findHeaderValue(header, "Upgrade");

        // WebSocket 프로토콜 감지
        if (connection && upgrade &&
            connection.toLowerCase().includes('upgrade') &&
            upgrade.toLowerCase().includes('websocket')) {

            this._isWebSocket = true;

            // URL이 WSS인지 확인 (Secure WebSocket)
            const isSecureRequest = this._socketHandler.isSecure() ||
                (header.path.startsWith('wss://') ||
                    HttpUtil.isSecureWebSocketUrl(header.path));

            logger.info(`WebSocket upgrade request detected: ${this._socketHandler.id} (Secure: ${isSecureRequest})`);

            // Sec-WebSocket-* 헤더 존재 여부 확인 (RFC 6455)
            const wsKey = HttpUtil.findHeaderValue(header, "Sec-WebSocket-Key");
            const wsVersion = HttpUtil.findHeaderValue(header, "Sec-WebSocket-Version");

            if (wsKey && wsVersion) {
                logger.info(`Valid WebSocket handshake: key=${wsKey}, version=${wsVersion}`);
            } else {
                logger.warn(`Incomplete WebSocket headers: key=${wsKey}, version=${wsVersion}`);
            }
        }
    }

    private callEvent(state: SocketState, data?: any): void {
        if (data) {
            this._receiveLength += Buffer.byteLength(data);
        }
        this._event?.(this, state, data);
    }

    private manipulateResponseHeader(header: HttpResponseHeader): void {
        // 업그레이드 응답인지 확인 (웹소켓 핸드셰이크 완료)
        if (header.status === 101 && header.upgrade) {
            this._isUpgrade = true;

            // 웹소켓인 경우 별도 처리
            if (this._isWebSocket) {
                logger.info(`WebSocket connection established: ${this._socketHandler.id} (Secure: ${this._socketHandler.isSecure()})`);

                // WebSocket 필수 헤더가 있는지 확인
                const wsAccept = HttpUtil.findHeaderValue(header, "Sec-WebSocket-Accept");

                if (wsAccept) {
                    logger.info(`Valid WebSocket response: accept=${wsAccept}`);
                } else {
                    logger.warn(`Missing Sec-WebSocket-Accept header in WebSocket response`);
                }

                // WSS 연결인 경우 추가 처리
                if (this._socketHandler.isSecure()) {
                    logger.info(`Secure WebSocket (WSS) connection active`);
                }
            }
        }

        let host = this.findHostFromHeader(header);
        if (host != "" && this._originHost != "") {
            this.replaceHostInHeader(header, host, this._originHost);
        }
        
        this.appendCustomHeader(header, this._option.customResponseHeaders);
        this.replaceLocationInResponseHeaderAt3XX(header);
        this.removeDomainInSetCookie(<HttpResponseHeader>header);
        
        this._isReplaceHostInBody = this._option.rewriteHostInTextBody == true && 
                                   HttpUtil.isTextContentType(header) && 
                                   (header.contentLength > 0 || header.chunked);
        
        this.changeModeOfReplaceHostInBodyInResponseHeader(header);
        
        if (this._option.replaceAccessControlAllowOrigin == true) {
            HttpUtil.removeHeader(header, "Access-Control-Allow-Origin");
            if (this._originAddress != "") {
                header.headers.push({name: "Access-Control-Allow-Origin", value: this._originAddress});
            } else {
                let protocol: string = this._socketHandler.isSecure() ? "https://" : "http://";
                header.headers.push({name: "Access-Control-Allow-Origin", value: protocol + this._originHost});
            }
        }
        
        let headerBuffer = HttpUtil.convertHttpHeaderToBuffer(header);
        this._socketHandler.sendData(headerBuffer, (client, success) => {
            if (success) {
                this._sendLength = this._bufLength;
            }
        });
    }

    private appendCustomHeader(header: HttpHeader, userHeaders?: Array<CustomHeader>): void {
        if (!userHeaders) {
            return;
        }
        
        userHeaders.forEach((nameValue) => {
            if (nameValue.replace) {
                HttpUtil.removeHeader(header, nameValue.name);
            }
            header.headers.push(nameValue);
        });
    }

    private replaceLocationInResponseHeaderAt3XX(header: HttpResponseHeader): void {
        let httpStatus = (<HttpResponseHeader>header).status;
        if (httpStatus >= 300 && httpStatus < 400) {
            header.headers.find((nameValue) => {
                if (nameValue.name.toLowerCase() == "location") {
                    nameValue.value = nameValue.value.replace(this._destinationAddress, this._originHost);
                    return true;
                }
                return false;
            });
        }
    }

    private changeModeOfReplaceHostInBodyInResponseHeader(header: HttpResponseHeader): void {
        this._currentHttpPipe.setDeliverPureData(this._isReplaceHostInBody);
        
        if (this._isReplaceHostInBody) {
            HttpUtil.removeHeader(header, "Content-Length");
            HttpUtil.removeHeader(header, "Transfer-Encoding");
            header.headers.push({name: "Transfer-Encoding", value: "chunked"});
        }
    }

    private removeDomainInSetCookie(header: HttpResponseHeader): void {
        let setCookies = HttpUtil.findHeaders(header, "Set-Cookie");
        for (let setCookie of setCookies) {
            setCookie.value = setCookie.value.replace(/Domain=[^;]+;/ig, "");
        }
    }

    private replaceHostInHeader(header: HttpHeader, host: string, replaceHost: string): void {
        for (let nameValue of header.headers) {
            if (nameValue.value.indexOf(host) > -1) {
                nameValue.value = nameValue.value.replace(host, replaceHost);
            }
        }
    }

    private findHostFromHeader(header: HttpRequestHeader | HttpResponseHeader, name: string = "Host"): string {
        let nameValue = HttpUtil.findHeader(header, name);
        if (nameValue != null) {
            return nameValue.value;
        }
        return "";
    }

    private onHttpBody = (data: Buffer): boolean => {
        if (this._socketHandler.isEnd()) {
            return false;
        }

        if (this._isReplaceHostInBody) {
            // 최대 버퍼 크기 점검
            if (this._bodyBuffer.length + data.length > MAX_BUFFER_SIZE) {
                logger.error(`Body buffer size would exceed maximum (${this._bodyBuffer.length + data.length} > ${MAX_BUFFER_SIZE})`);
                return false;
            }
            this._bodyBuffer = Buffer.concat([this._bodyBuffer, data]);
        }
        else if (this._httpMessageType == MessageType.Request) {
            this.callEvent(SocketState.Receive, data);
        } else {
            this._socketHandler.sendData(data, (client, success) => {
                if (success) {
                    this._sendLength = this._bufLength;
                }
            });
        }
        return true;
    }

    private onHttpMessageEnd = (): void => {
        if (this._isReplaceHostInBody) {
            this.replaceAndSendHostInBody();
        }

        if (this._httpMessageType == MessageType.Request) {
            this._currentHttpPipe.reset(MessageType.Response);
            this._httpMessageType = MessageType.Response;
        } else {
            this._currentHttpPipe.reset(MessageType.Request);
            this._httpMessageType = MessageType.Request;
        }
    }

    private onHttpMessageError = (error: Error): void => {
        this._bodyBuffer = Buffer.alloc(0);
        this._isReplaceHostInBody = false;
        this._httpMessageType = MessageType.Request;
        this._currentHttpPipe.reset(MessageType.Request);
        logger.error('HTTP Message parse Error', error);
        this._socketHandler.destroy();
    }

    public sendData(data: Buffer): void {
        if (this._socketHandler.isEnd()) {
            return;
        }
        
        if (this._isUpgrade) {
            this._bufLength += data.length;

            this._socketHandler.sendData(data, (client, success) => {
                if (success) {
                    this._sendLength = this._bufLength;
                } else {
                    logger.warn(`Failed to send WebSocket data: ${data.length} bytes`);
                }
            });
            return;
        }
        
        if (this._httpMessageType == MessageType.Request) {
            this._currentHttpPipe.reset(MessageType.Response);
            this._httpMessageType = MessageType.Response;
        }
        
        this._bufLength += data.length;
        this._currentHttpPipe.write(data);
    }

    public end_(): void {
        this.release();
        this._socketHandler.end_();
    }

    public destroy(): void {
        this.release();
        this._socketHandler.destroy();
    }

    private release(): void {
        this._currentHttpPipe.reset(MessageType.Request);
        this._httpMessageType = MessageType.Request;
        this._isUpgrade = false;
        this._isWebSocket = false;
        this._keepAlive = false;
        this._bodyBuffer = Buffer.alloc(0);
    }

    private replaceAndSendHostInBody(): void {
        try {
            let encoding = HttpUtil.findHeaderValue(this._currentHttpHeader!, "Content-Encoding");
            
            // 압축 해제
            this._bodyBuffer = HttpUtil.uncompressBody(encoding, this._bodyBuffer);
            
            let body = this._bodyBuffer.toString();
            body = this.modifyUrlsInBody(body, this._destinationAddress, this._originHost);
            body = this.modifyBodyByRule(body);
            
            this._bodyBuffer = Buffer.from(body);
            
            // 다시 압축
            this._bodyBuffer = HttpUtil.compressBody(encoding, this._bodyBuffer);

            // chunked 인코딩으로 데이터 전송
            this.sendChunkedData(this._bodyBuffer);
            
            this._currentHttpHeader = null;
            this._bodyBuffer = Buffer.alloc(0);
            this._isReplaceHostInBody = false;
        } catch (err) {
            logger.error('Error replacing host in body', err);
            this._socketHandler.destroy();
        }
    }

    private sendChunkedData(buffer: Buffer): void {
        let offset = 0;
        const totalLength = buffer.length;
        
        // 큰 데이터를 청크로 나누어 전송
        while (offset < totalLength) {
            const chunkSize = Math.min(CHUNK_SIZE, totalLength - offset);
            const chunk = buffer.subarray(offset, offset + chunkSize);
            offset += chunkSize;
            
            // 청크 크기 헤더 전송
            this._socketHandler.sendData(Buffer.from(chunk.length.toString(16) + "\r\n"));
            
            // 청크 데이터 전송
            this._socketHandler.sendData(chunk);
            
            // 청크 종료 전송
            this._socketHandler.sendData(Buffer.from("\r\n"));
        }
        
        // 청크 종료 표시 (0 길이 청크)
        this._socketHandler.sendData(Buffer.from("0\r\n\r\n"), (client, success) => {
            if (success) {
                this._sendLength = this._bufLength;
            }
        });
    }

    private modifyBodyByRule(body: string): string {
        let rules = this._option.bodyRewriteRules;
        if (!rules) {
            return body;
        }
        
        for (let rule of rules) {
            try {
                let regx = this.createRegExp(rule.from);
                body = body.replaceAll(regx, rule.to);
            } catch (err) {
                logger.error(`Error applying rewrite rule ${rule.from} -> ${rule.to}`, err);
            }
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
        try {
            // 모든 URL 프로토콜 패턴 (http://, https://, ws://, wss://)
            const urlPattern = /(https?:\/\/|wss?:\/\/)[^\s'"]+/gi;

            return body.replace(urlPattern, url => {
                // URL이 WebSocket URL인지 확인
                const isWsUrl = HttpUtil.isWebSocketUrl(url);

                // 프로토콜 부분을 분리
                const protocolMatch = url.match(/(https?:\/\/|wss?:\/\/)/i);
                if (!protocolMatch) return url;

                const protocol = protocolMatch[0];
                let hostPart = url.substring(protocol.length);

                // 호스트가 originHost로 시작하는지 확인
                if (hostPart.startsWith(originHost)) {
                    // originHost를 host로 대체
                    hostPart = hostPart.replace(originHost, host);
                    return protocol + hostPart;
                }

                return url;
            });
        } catch (err) {
            logger.error('Error modifying URLs in body', err);
            return body;
        }
    }
}

export default HttpHandler;
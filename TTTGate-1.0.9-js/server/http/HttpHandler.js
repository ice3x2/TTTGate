"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const HttpPipe_1 = require("./HttpPipe");
const HttpUtil_1 = __importDefault(require("./HttpUtil"));
const HttpUtil_2 = __importDefault(require("./HttpUtil"));
const SocketState_1 = __importDefault(require("../../util/SocketState"));
const LoggerFactory_1 = __importDefault(require("../../util/logger/LoggerFactory"));
let logger = LoggerFactory_1.default.getLogger('server', 'HttpHandler');
const CHUNK_SIZE = 1024;
// noinspection JSUnusedGlobalSymbols
class HttpHandler {
    _socketHandler;
    _currentHttpPipe = new HttpPipe_1.HttpPipe();
    _isUpgrade = false;
    _originHost = "";
    _httpMessageType = HttpPipe_1.MessageType.Request;
    _currentHttpHeader = null;
    _event = null;
    _isReplaceHostInBody = false;
    _bodyBuffer = Buffer.alloc(0);
    _originAddress = "";
    _destinationAddress = "";
    _option = {};
    _receiveLength = 0;
    _bufLength = 0;
    _sendLength = 0;
    _leftBufferStateInEnd = false;
    set onSocketEvent(event) {
        this._event = event;
    }
    get receiveLength() {
        return this._receiveLength;
    }
    get sendLength() {
        return this._sendLength;
    }
    static create(socketHandler, tunnelOption) {
        let handler = new HttpHandler(socketHandler);
        handler._option = !tunnelOption.httpOption ? handler._option : tunnelOption.httpOption;
        if (handler._option.rewriteHostInTextBody == undefined) {
            handler._option.rewriteHostInTextBody = true;
        }
        if (handler._option.replaceAccessControlAllowOrigin == undefined) {
            handler._option.replaceAccessControlAllowOrigin = true;
        }
        handler._destinationAddress = tunnelOption.destinationAddress;
        return handler;
    }
    get id() {
        return this._socketHandler.id;
    }
    setBundle(key, value) {
        this._socketHandler.setBundle(key, value);
    }
    getBundle(key) {
        ``;
        return this._socketHandler.getBundle(key);
    }
    deleteBundle(key) {
        this._socketHandler.deleteBundle(key);
    }
    constructor(socketHandler) {
        this._socketHandler = socketHandler;
        socketHandler.onSocketEvent = this.onSocketEventFromSocketHandler;
        this._currentHttpPipe.onHeaderCallback = this.onHttpHeader;
        this._currentHttpPipe.onDataCallback = this.onHttpBody;
        this._currentHttpPipe.onEndCallback = this.onHttpMessageEnd;
        this._currentHttpPipe.onErrorCallback = this.onHttpMessageError;
    }
    onSocketEventFromSocketHandler = (handler, state, data) => {
        if (state == SocketState_1.default.Receive && !this._socketHandler.isEnd()) {
            if (this._isUpgrade) {
                this.callEvent(SocketState_1.default.Receive, data);
                return;
            }
            if (this._currentHttpPipe.messageType == HttpPipe_1.MessageType.Response) {
                this._currentHttpPipe.reset(HttpPipe_1.MessageType.Request);
            }
            this._currentHttpPipe.write(data);
        }
        else {
            if (this._socketHandler.isEnd() || SocketState_1.default.End == state || /*SocketState.Error == state ||*/ SocketState_1.default.Closed == state) {
                this._leftBufferStateInEnd = this._currentHttpPipe.bufferSize > 0;
                this._sendLength = this._bufLength;
                this.release();
            }
            this.callEvent(state);
            if (state == SocketState_1.default.Closed) {
                this._event = null;
            }
        }
    };
    onHttpHeader = (header) => {
        this._currentHttpHeader = header;
        if (header.type == HttpPipe_1.MessageType.Request) {
            this.manipulateRequestHeader(header);
        }
        else if (header.type == HttpPipe_1.MessageType.Response) {
            this.manipulateResponseHeader(header);
        }
    };
    get breakBufferFlush() {
        return this._socketHandler.breakBufferFlush || this._leftBufferStateInEnd;
    }
    manipulateRequestHeader(header) {
        this._originAddress = "";
        this._originHost = this.findHostFromHeader(header);
        if (this._originHost != "") {
            this.replaceHostInHeader(header, this._originHost, this._destinationAddress);
            let requestHeader = header;
            requestHeader.path = requestHeader.path.replaceAll(this._originHost, this._destinationAddress);
        }
        let origin = HttpUtil_1.default.findHeaderValue(header, "Origin");
        if (origin != null) {
            this._originAddress = origin;
        }
        this.appendCustomHeader(header, this._option.customRequestHeaders);
        let headerBuffer = HttpUtil_1.default.convertHttpHeaderToBuffer(header);
        this.callEvent(SocketState_1.default.Receive, headerBuffer);
    }
    callEvent(state, data) {
        if (data) {
            this._receiveLength += Buffer.byteLength(data);
        }
        this._event?.(this, state, data);
    }
    manipulateResponseHeader(header) {
        this._isUpgrade = header.upgrade;
        let host = this.findHostFromHeader(header);
        if (host != "" && this._originHost != "") {
            this.replaceHostInHeader(header, host, this._originHost);
        }
        this.appendCustomHeader(header, this._option.customResponseHeaders);
        this.replaceLocationInResponseHeaderAt3XX(header);
        this.removeDomainInSetCookie(header);
        this._isReplaceHostInBody = this._option.rewriteHostInTextBody == true && HttpUtil_1.default.isTextContentType(header) && (header.contentLength > 0 || header.chunked);
        this.changeModeOfReplaceHostInBodyInResponseHeader(header);
        if (this._option.replaceAccessControlAllowOrigin == true) {
            HttpUtil_1.default.removeHeader(header, "Access-Control-Allow-Origin");
            if (this._originAddress != "") {
                header.headers.push({ name: "Access-Control-Allow-Origin", value: this._originAddress });
            }
            else {
                let protocol = this._socketHandler.isSecure() ? "https://" : "http://";
                header.headers.push({ name: "Access-Control-Allow-Origin", value: protocol + this._originHost });
            }
        }
        let headerBuffer = HttpUtil_1.default.convertHttpHeaderToBuffer(header);
        this._socketHandler.sendData(headerBuffer, (client, success) => {
            if (success) {
                this._sendLength = this._bufLength;
            }
        });
    }
    appendCustomHeader(header, userHeaders) {
        if (!userHeaders) {
            return;
        }
        userHeaders.forEach((nameValue) => {
            if (nameValue.replace) {
                HttpUtil_1.default.removeHeader(header, nameValue.name);
            }
            header.headers.push(nameValue);
        });
    }
    replaceLocationInResponseHeaderAt3XX(header) {
        let httpStatus = header.status;
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
    changeModeOfReplaceHostInBodyInResponseHeader(header) {
        this._currentHttpPipe.setDeliverPureData(this._isReplaceHostInBody);
        if (this._isReplaceHostInBody) {
            HttpUtil_1.default.removeHeader(header, "Content-Length");
            HttpUtil_2.default.removeHeader(header, "Transfer-Encoding");
            header.headers.push({ name: "Transfer-Encoding", value: "chunked" });
        }
    }
    removeDomainInSetCookie(header) {
        let setCookies = HttpUtil_1.default.findHeaders(header, "Set-Cookie");
        for (let setCookie of setCookies) {
            setCookie.value = setCookie.value.replace(/Domain=[^;]+;/ig, "");
        }
    }
    replaceHostInHeader(header, host, replaceHost) {
        for (let nameValue of header.headers) {
            if (nameValue.value.indexOf(host) > -1) {
                nameValue.value = nameValue.value.replace(host, replaceHost);
            }
        }
    }
    findHostFromHeader(header, name = "Host") {
        let nameValue = HttpUtil_1.default.findHeader(header, name);
        if (nameValue != null) {
            return nameValue.value;
        }
        return "";
    }
    onHttpBody = (data) => {
        if (this._socketHandler.isEnd()) {
            return false;
        }
        if (this._isReplaceHostInBody) {
            this._bodyBuffer = Buffer.concat([this._bodyBuffer, data]);
        }
        else if (this._httpMessageType == HttpPipe_1.MessageType.Request) {
            this.callEvent(SocketState_1.default.Receive, data);
        }
        else {
            this._socketHandler.sendData(data, (client, success) => {
                if (success) {
                    this._sendLength = this._bufLength;
                }
            });
        }
        return true;
    };
    onHttpMessageEnd = () => {
        if (this._isReplaceHostInBody) {
            this.replaceAndSendHostInBody();
        }
        if (this._httpMessageType == HttpPipe_1.MessageType.Request) {
            this._currentHttpPipe.reset(HttpPipe_1.MessageType.Response);
            this._httpMessageType = HttpPipe_1.MessageType.Response;
        }
        else {
            this._currentHttpPipe.reset(HttpPipe_1.MessageType.Request);
            this._httpMessageType = HttpPipe_1.MessageType.Request;
        }
    };
    onHttpMessageError = (error) => {
        this._bodyBuffer = Buffer.alloc(0);
        this._isReplaceHostInBody = false;
        this._httpMessageType = HttpPipe_1.MessageType.Request;
        this._currentHttpPipe.reset(HttpPipe_1.MessageType.Request);
        logger.error('HTTP Message parse Error', error);
        this._socketHandler.destroy();
    };
    sendData(data) {
        if (this._socketHandler.isEnd()) {
            return;
        }
        if (this._isUpgrade) {
            this._bufLength += data.length;
            this._socketHandler.sendData(data, (client, success) => {
                if (success) {
                    this._sendLength = this._bufLength;
                }
            });
            return;
        }
        if (this._httpMessageType == HttpPipe_1.MessageType.Request) {
            this._currentHttpPipe.reset(HttpPipe_1.MessageType.Response);
            this._httpMessageType = HttpPipe_1.MessageType.Response;
        }
        this._bufLength += data.length;
        this._currentHttpPipe.write(data);
    }
    end_() {
        this.release();
        this._socketHandler.end_();
    }
    destroy() {
        this.release();
        this._socketHandler.destroy();
    }
    release() {
        this._currentHttpPipe.reset(HttpPipe_1.MessageType.Request);
        this._httpMessageType = HttpPipe_1.MessageType.Request;
        this._isUpgrade = false;
    }
    replaceAndSendHostInBody() {
        let encoding = HttpUtil_1.default.findHeaderValue(this._currentHttpHeader, "Content-Encoding");
        this._bodyBuffer = HttpUtil_1.default.uncompressBody(encoding, this._bodyBuffer);
        let body = this._bodyBuffer.toString();
        body = this.modifyUrlsInBody(body, this._destinationAddress, this._originHost);
        body = this.modifyBodyByRule(body);
        this._bodyBuffer = Buffer.from(body);
        this._bodyBuffer = HttpUtil_1.default.compressBody(encoding, this._bodyBuffer);
        // this._bodyBuffer 를 1024byte 씩 끊어서 보내야함
        let bodyBuffer = this._bodyBuffer;
        while (bodyBuffer.length > 0) {
            let sendBuffer = bodyBuffer.subarray(0, Math.min(CHUNK_SIZE, bodyBuffer.length));
            bodyBuffer = bodyBuffer.subarray(sendBuffer.length);
            this._socketHandler.sendData(Buffer.from(sendBuffer.length.toString(16) + "\r\n"));
            this._socketHandler.sendData(sendBuffer);
            this._socketHandler.sendData(Buffer.from("\r\n"));
        }
        this._socketHandler.sendData(Buffer.from("0\r\n\r\n"), (client, success) => {
            if (success) {
                this._sendLength = this._bufLength;
            }
        });
        this._currentHttpHeader = null;
        this._bodyBuffer = Buffer.alloc(0);
        this._isReplaceHostInBody = false;
    }
    modifyBodyByRule(body) {
        let rules = this._option.bodyRewriteRules;
        if (!rules) {
            return body;
        }
        for (let rule of rules) {
            let regx = this.createRegExp(rule.from);
            body = body.replaceAll(regx, rule.to);
        }
        return body;
    }
    createRegExp(pattern) {
        const regexPattern = /^\/(.+)\/([gim]*)$/; // 정규식 패턴 검사용 정규식
        const match = pattern.match(regexPattern);
        if (match) {
            try {
                const [, patternStr, flags] = match;
                return new RegExp(patternStr, flags);
            }
            catch (error) {
                logger.error('Error creating RegExp:' + pattern, error);
                return pattern; // 잘못된 정규식 패턴일 경우 그대로 문자열 반환
            }
        }
        else {
            return pattern;
        }
    }
    modifyUrlsInBody(body, originHost, host) {
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
exports.default = HttpHandler;

"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MessageType = exports.HttpMethod = exports.HttpPipe = void 0;
const buffer_1 = require("buffer");
var HttpMethod;
(function (HttpMethod) {
    HttpMethod[HttpMethod["GET"] = 0] = "GET";
    HttpMethod[HttpMethod["POST"] = 1] = "POST";
    HttpMethod[HttpMethod["PUT"] = 2] = "PUT";
    HttpMethod[HttpMethod["DELETE"] = 3] = "DELETE";
    HttpMethod[HttpMethod["HEAD"] = 4] = "HEAD";
    HttpMethod[HttpMethod["OPTIONS"] = 5] = "OPTIONS";
    HttpMethod[HttpMethod["TRACE"] = 6] = "TRACE";
    HttpMethod[HttpMethod["CONNECT"] = 7] = "CONNECT";
    HttpMethod[HttpMethod["PATCH"] = 8] = "PATCH";
})(HttpMethod || (exports.HttpMethod = HttpMethod = {}));
var ParseState;
(function (ParseState) {
    ParseState[ParseState["SEARCHING_FOR_HEADER"] = 0] = "SEARCHING_FOR_HEADER";
    ParseState[ParseState["HEADER"] = 1] = "HEADER";
    ParseState[ParseState["UPGRADE"] = 2] = "UPGRADE";
    ParseState[ParseState["CONTENT_LENGTH_BODY"] = 3] = "CONTENT_LENGTH_BODY";
    ParseState[ParseState["CHUNKED_SIZE"] = 4] = "CHUNKED_SIZE";
    ParseState[ParseState["CHUNKED_DATA"] = 5] = "CHUNKED_DATA";
    ParseState[ParseState["UNKNOWN_LENGTH_BODY"] = 6] = "UNKNOWN_LENGTH_BODY";
    ParseState[ParseState["END"] = 7] = "END";
})(ParseState || (ParseState = {}));
var MessageType;
(function (MessageType) {
    MessageType[MessageType["Request"] = 0] = "Request";
    MessageType[MessageType["Response"] = 1] = "Response";
})(MessageType || (exports.MessageType = MessageType = {}));
const EMPTY_BUFFER = buffer_1.Buffer.alloc(0);
const CRLF_BUFFER = buffer_1.Buffer.from("\r\n");
var ReadResult;
(function (ReadResult) {
    ReadResult[ReadResult["Continue"] = 0] = "Continue";
    ReadResult[ReadResult["Closed"] = 1] = "Closed";
    ReadResult[ReadResult["End"] = 2] = "End";
})(ReadResult || (ReadResult = {}));
const MAX_RECURSIVE_CALL_LEVEL = 1000;
// noinspection JSUnusedGlobalSymbols
class HttpPipe {
    _buffer = buffer_1.Buffer.alloc(0);
    _header = null;
    _state = ParseState.SEARCHING_FOR_HEADER;
    _maxHeaderSize = 1024 * 1024;
    _messageType = MessageType.Request;
    _chunkedSize = 0;
    _chunkedSizeRead = 0;
    _contentLengthRead = 0;
    _deliverPureData = false;
    _recursiveCallLevel = 0;
    _onErrorCallback;
    _onDataCallback;
    _onEndCallback;
    _onHeaderCallback;
    set onErrorCallback(callback) {
        this._onErrorCallback = callback;
    }
    set onDataCallback(callback) {
        this._onDataCallback = callback;
    }
    set onEndCallback(callback) {
        this._onEndCallback = callback;
    }
    set onHeaderCallback(callback) {
        this._onHeaderCallback = callback;
    }
    static createHttpRequestPipe() {
        let pipe = new HttpPipe();
        pipe._messageType = MessageType.Request;
        return pipe;
    }
    setDeliverPureData(enable) {
        this._deliverPureData = enable;
    }
    get messageType() {
        return this._messageType;
    }
    get bufferSize() {
        return this._buffer.length;
    }
    constructor() { }
    reset(messageType) {
        this._deliverPureData = false;
        this._messageType = messageType;
        this._buffer = buffer_1.Buffer.alloc(0);
        this._state = ParseState.SEARCHING_FOR_HEADER;
        this._chunkedSize = 0;
        this._chunkedSizeRead = 0;
        this._contentLengthRead = 0;
    }
    isNoneBodyMethod(method) {
        return method == HttpMethod.GET || method == HttpMethod.HEAD || method == HttpMethod.OPTIONS || method == HttpMethod.TRACE || method == HttpMethod.CONNECT || method == HttpMethod.DELETE;
    }
    rewriteBufferIfNeed() {
        if (this._buffer.length > 0) {
            this.write(EMPTY_BUFFER);
        }
    }
    write(buffer) {
        try {
            this._buffer = buffer_1.Buffer.concat([this._buffer, buffer]);
            if (this._state == ParseState.SEARCHING_FOR_HEADER) {
                this._header = this.parseHeader();
                if (!this._header) {
                    return;
                }
                if (!this._onHeaderCallback) {
                    return;
                }
                this._onHeaderCallback?.(this._header);
                if (this._header.upgrade) {
                    this._state = ParseState.UPGRADE;
                }
                else if (this._header.chunked) {
                    this._state = ParseState.CHUNKED_SIZE;
                }
                else if (this._header.contentLength > 0) {
                    this._state = ParseState.CONTENT_LENGTH_BODY;
                }
                else if (this._header.contentLength == 0) {
                    this.setEnd();
                }
                else if (this._header.type == MessageType.Request && this.isNoneBodyMethod(this._header.method)) {
                    this.setEnd();
                    return;
                }
                else {
                    this.setEnd();
                    //this._state = ParseState.UNKNOWN_LENGTH_BODY;
                }
            }
            else if (this._state == ParseState.CHUNKED_SIZE) {
                let result = this.readChunkedSize();
                if (result == ReadResult.End || result == ReadResult.Closed) {
                    return;
                }
                this._state = ParseState.CHUNKED_DATA;
            }
            else if (this._state == ParseState.CHUNKED_DATA) {
                let result = this.readChunkedData();
                if (result == ReadResult.Closed || result == ReadResult.End) {
                    return;
                }
            }
            else if (this._state == ParseState.CONTENT_LENGTH_BODY) {
                let result = this.readBodyInContentLengthMode(this._header.contentLength);
                if (result == ReadResult.Closed || result == ReadResult.End) {
                    return;
                }
            }
            else if (this._state == ParseState.UNKNOWN_LENGTH_BODY || this._state == ParseState.UPGRADE) {
                /*let buffer = this.readBodyInUnknownLengthMode();
                if (buffer == null) {
                    return;
                }
                if(!this._onDataCallback || !this._onDataCallback?.(buffer)) {
                    return;
                }*/
                this._onErrorCallback?.(new Error('Content length unknown'));
            }
            if (!this._onDataCallback) {
                return;
            }
            this._recursiveCallLevel++;
            if (this._recursiveCallLevel > MAX_RECURSIVE_CALL_LEVEL) {
                this._recursiveCallLevel = 0;
                process.nextTick(() => this.rewriteBufferIfNeed());
            }
            else {
                this.rewriteBufferIfNeed();
            }
        }
        catch (err) {
            if (err instanceof Error) {
                this._onErrorCallback?.(err);
            }
            else {
                throw err;
            }
        }
    }
    bufferToHttpHeader(buffer) {
        let bufferList = this.splitHeaderBuffer(buffer);
        let firstLine = bufferList.shift();
        let isRequest = this._messageType == MessageType.Request;
        if (firstLine == null) {
            throw new Error(`Invalid ${isRequest ? 'request' : 'response'} header`);
        }
        let headerInfo = isRequest ? this.parseRequestHeader(firstLine) : this.parseResponseHeader(firstLine);
        let nameValueList = this.parseHeaderList(bufferList);
        let httpHeader = {
            headers: nameValueList,
            contentLength: -1,
            upgrade: false,
            chunked: false
        };
        return Object.assign(httpHeader, headerInfo);
    }
    findAndSetLengthValue(header) {
        header.headers.forEach((nameValue) => {
            if (nameValue.name.toLowerCase() == 'content-length') {
                header.contentLength = parseInt(nameValue.value);
            }
            else if (nameValue.name.toLowerCase() == 'transfer-encoding') {
                header.chunked = nameValue.value.toLowerCase() == 'chunked';
            }
            else if (nameValue.name.toLowerCase() == 'upgrade') {
                header.upgrade = true;
            }
        });
    }
    assertFirstLineForResponse(buffer) {
        let idx = buffer.indexOf(" ");
        if (idx < 0) {
            if (buffer.length > 8) {
                throw new Error(`Invalid response header`);
            }
        }
        buffer = buffer.subarray(0, idx);
        let str = buffer.toString();
        if (str != 'HTTP/1.0' && str != 'HTTP/1.1' && str != 'http/1.0' && str != 'http/1.1') {
            throw new Error(`Invalid response header: ${str}`);
        }
    }
    assertFirstLineForRequest(buffer) {
        let idx = buffer.indexOf(" ");
        if (idx < 0) {
            if (buffer.length > 7) {
                throw new Error(`Invalid request header`);
            }
        }
        buffer = buffer.subarray(0, idx);
        let str = buffer.toString();
        this.methodStringToMethod(str);
    }
    parseHeader() {
        if (this._messageType == MessageType.Response)
            this.assertFirstLineForResponse(this._buffer);
        else
            this.assertFirstLineForRequest(this._buffer);
        let idx = this._buffer.indexOf("\r\n\r\n");
        if (idx < 0) {
            return null;
        }
        if (idx > this._maxHeaderSize) {
            throw new Error(`Header too large. Max size is ${this._maxHeaderSize} bytes`);
        }
        this._state = ParseState.HEADER;
        let headerBuffer = this._buffer.subarray(0, idx);
        this._buffer = this._buffer.subarray(idx + 4);
        let header = this.bufferToHttpHeader(headerBuffer);
        this.findAndSetLengthValue(header);
        return header;
    }
    readBodyInContentLengthMode(contentLength) {
        let readable = contentLength - this._contentLengthRead;
        if (this._buffer.length < readable) {
            if (!this._onDataCallback || !this._onDataCallback?.(this._buffer)) {
                return ReadResult.Closed;
            }
            this._contentLengthRead += this._buffer.length;
            this._buffer = buffer_1.Buffer.alloc(0);
            return ReadResult.End;
        }
        let bodyBuffer = this._buffer.subarray(0, readable);
        this._buffer = this._buffer.subarray(readable);
        this._contentLengthRead += readable;
        if (!this._onDataCallback || !this._onDataCallback?.(bodyBuffer)) {
            return ReadResult.Closed;
        }
        if (this._contentLengthRead == contentLength) {
            this.setEnd();
        }
        else if (this._contentLengthRead > contentLength) {
            // This should never happen ^_^;;f
            throw new Error(`Invalid content length. Expected ${contentLength} bytes but got ${this._contentLengthRead} bytes`);
        }
        return ReadResult.Continue;
    }
    readBodyInUnknownLengthMode() {
        let buffer = this._buffer;
        this._buffer = buffer_1.Buffer.alloc(0);
        return buffer;
    }
    readChunkedSize() {
        let idx = this._buffer.indexOf(CRLF_BUFFER);
        if (idx == 0) {
            this._buffer = this._buffer.subarray(2);
            idx = this._buffer.indexOf(CRLF_BUFFER);
        }
        if (idx == 0) {
            return ReadResult.Closed;
        }
        if (idx < 0) {
            return ReadResult.End;
        }
        let chunkedSizeBuffer = this._buffer.subarray(0, idx);
        this._chunkedSize = parseInt(chunkedSizeBuffer.toString(), 16);
        if (isNaN(this._chunkedSize)) {
            throw new Error(`Invalid chunked size ${chunkedSizeBuffer.toString()}`);
        }
        this._chunkedSizeRead = 0;
        this._state = ParseState.CHUNKED_DATA;
        if (!this._deliverPureData) {
            let sendSuccess = this._onDataCallback && !this._onDataCallback?.(chunkedSizeBuffer);
            if (!sendSuccess) {
                return ReadResult.Closed;
            }
            sendSuccess = this._onDataCallback && !this._onDataCallback?.(CRLF_BUFFER);
            if (!sendSuccess) {
                return ReadResult.Closed;
            }
        }
        this._buffer = this._buffer.subarray(idx + 2);
        return ReadResult.Continue;
    }
    readChunkedData() {
        let readable = this._chunkedSize - this._chunkedSizeRead;
        if (this._chunkedSize == 0) {
            if (this._buffer.length >= 2) {
                this._buffer = this._buffer.subarray(2);
                if (!this._deliverPureData) {
                    let sendSuccess = this._onDataCallback && !this._onDataCallback?.(CRLF_BUFFER);
                    if (!sendSuccess) {
                        return ReadResult.Closed;
                    }
                }
                this.setEnd();
                return ReadResult.Continue;
            }
            return ReadResult.End;
        }
        else if (this._buffer.length < readable) {
            return ReadResult.End;
        }
        let chunkedDataBuffer = this._buffer.subarray(0, readable);
        this._buffer = this._buffer.subarray(readable);
        this._chunkedSizeRead += chunkedDataBuffer.length;
        if (this._chunkedSizeRead == this._chunkedSize) {
            let leftChunkIdx = this._buffer.indexOf(CRLF_BUFFER);
            if (leftChunkIdx > 0) {
                throw new Error(`Invalid chunked data. Expected ${this._chunkedSize} bytes but got ${this._chunkedSizeRead} bytes`);
            }
            else if (leftChunkIdx <= 0) {
                /*if(leftChunkIdx == 0) {
                    this._buffer = this._buffer.subarray(2);
                } else {
                    this._buffer = Buffer.alloc(0);
                }*/
                this._state = ParseState.CHUNKED_SIZE;
                if (!this._deliverPureData) {
                    chunkedDataBuffer = buffer_1.Buffer.concat([chunkedDataBuffer, CRLF_BUFFER]);
                }
            }
        }
        else if (this._chunkedSizeRead > this._chunkedSize) {
            // Should never happen. ^_^;;
            throw new Error(`Chunked data read too much. Expected ${this._chunkedSize} bytes, read ${this._chunkedSizeRead} bytes`);
        }
        if (!this._onDataCallback || !this._onDataCallback?.(chunkedDataBuffer)) {
            return ReadResult.Closed;
        }
        return ReadResult.Continue;
    }
    parseResponseHeader(firstLine) {
        let firstLineList = this.splitFirstLine(firstLine);
        let version = firstLineList[0];
        let status = parseInt(firstLineList[1]);
        let statusText = firstLineList[2];
        return { type: MessageType.Response, version: version, status: status, statusText: statusText };
    }
    parseRequestHeader(firstLine) {
        let firstLineList = this.splitFirstLine(firstLine);
        let method = this.methodStringToMethod(firstLineList[0]);
        let path = firstLineList[1];
        let version = firstLineList[2];
        return { type: MessageType.Request, method: method, path: path, version: version };
    }
    splitFirstLine(firstLine) {
        let firstLineStr = firstLine.toString();
        let firstLineList = firstLineStr.split(" ");
        if (firstLineList.length < 3) {
            throw new Error("Invalid request header");
        }
        return firstLineList;
    }
    methodStringToMethod(method) {
        method = method.toUpperCase();
        switch (method) {
            case "GET": return HttpMethod.GET;
            case "POST": return HttpMethod.POST;
            case "PUT": return HttpMethod.PUT;
            case "DELETE": return HttpMethod.DELETE;
            case "HEAD": return HttpMethod.HEAD;
            case "OPTIONS": return HttpMethod.OPTIONS;
            case "TRACE": return HttpMethod.TRACE;
            case "CONNECT": return HttpMethod.CONNECT;
            case "PATCH": return HttpMethod.PATCH;
            default: throw new Error(`Invalid method ${method}`);
        }
    }
    splitHeaderBuffer(header) {
        let headerList = [];
        let start = 0;
        let end = 0;
        while (true) {
            end = header.indexOf("\r\n", start);
            if (end < 0) {
                break;
            }
            headerList.push(header.subarray(start, end));
            start = end + 2;
        }
        headerList.push(header.subarray(start));
        return headerList;
    }
    parseHeaderList(headerList) {
        let nameValueList = [];
        for (let header of headerList) {
            let idx = header.indexOf(":");
            if (idx < 0) {
                continue;
            }
            let name = header.subarray(0, idx).toString();
            let value = header.subarray(idx + 1).toString();
            nameValueList.push({ name: name.trim(), value: value.trim() });
        }
        return nameValueList;
    }
    setEnd() {
        this._header = null;
        this._state = ParseState.END;
        this._onEndCallback?.();
    }
}
exports.HttpPipe = HttpPipe;

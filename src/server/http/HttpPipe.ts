import {Buffer} from "buffer";
enum HttpMethod {
    GET,
    POST,
    PUT,
    DELETE,
    HEAD,
    OPTIONS,
    TRACE,
    CONNECT,
    PATCH,
}


enum ParseState {
    SEARCHING_FOR_HEADER,
    HEADER,
    UPGRADE,
    CONTENT_LENGTH_BODY,
    CHUNKED_SIZE,
    CHUNKED_DATA,
    UNKNOWN_LENGTH_BODY,
    END
}

interface NameValue  {
    name: string,
    value: string
}

type OnError = (err: Error) => void;
type OnData = (data: Buffer) => boolean;
type OnEnd = () => void;
type OnHeader = (header: HttpRequestHeader | HttpResponseHeader) => void;

type HttpHeader = {
    headers: Array<NameValue>,
    contentLength: number,
    upgrade: boolean,
    chunked: boolean
}



enum MessageType  {
    Request, Response
}

type RequestInfo = {
    type: MessageType.Request,
    method: HttpMethod,
    path: string,
    version: string
}

type ResponseInfo = {
    type: MessageType.Response,
    version: string,
    status: number,
    statusText: string
}

type HttpRequestHeader = HttpHeader & RequestInfo;
type HttpResponseHeader =  HttpHeader & ResponseInfo;

const EMPTY_BUFFER = Buffer.alloc(0);
const CRLF_BUFFER = Buffer.from("\r\n");


enum ReadResult {
    Continue,
    Closed,
    End

}

const MAX_RECURSIVE_CALL_LEVEL = 1000;

// noinspection JSUnusedGlobalSymbols
class HttpPipe {

    private _buffer : Buffer = Buffer.alloc(0);
    private _header : HttpRequestHeader | HttpResponseHeader | null = null;

    private _state : ParseState = ParseState.SEARCHING_FOR_HEADER;
    private _maxHeaderSize : number = 1024 * 1024;

    private _messageType : MessageType = MessageType.Request;

    private _readTimeout : number = 25000;
    private _lastRead : number = -1;

    private _chunkedSize : number = 0;
    private _chunkedSizeRead : number = 0;

    private _contentLengthRead : number = 0;

    private _deliverPureData : boolean = false;

    private _recursiveCallLevel : number = 0;

    private _onErrorCallback? : OnError;
    private _onDataCallback? : OnData;
    private _onEndCallback? : OnEnd;
    private _onHeaderCallback? : OnHeader;

    public set onErrorCallback(callback: OnError) {
        this._onErrorCallback = callback;
    }

    public set onDataCallback(callback: OnData) {
        this._onDataCallback = callback;
    }

    public set onEndCallback(callback: OnEnd) {
        this._onEndCallback = callback;
    }

    public set onHeaderCallback(callback: OnHeader) {
        this._onHeaderCallback = callback;
    }


    public static createHttpRequestPipe() : HttpPipe {
        let pipe = new HttpPipe();
        pipe._messageType = MessageType.Request;
        return pipe;
    }

    public setDeliverPureData(enable: boolean) {
        this._deliverPureData = enable;
    }


    public get messageType() : MessageType {
        return this._messageType;
    }



    public constructor() {}


    public reset(messageType: MessageType) : void {
        this._deliverPureData = false;
        this._messageType = messageType;
        this._buffer = Buffer.alloc(0);
        this._state = ParseState.SEARCHING_FOR_HEADER;
        this._chunkedSize = 0;
        this._chunkedSizeRead = 0;
        this._contentLengthRead = 0;
    }

    private isNoneBodyMethod(method: HttpMethod) : boolean {
        return method == HttpMethod.GET || method == HttpMethod.HEAD || method == HttpMethod.OPTIONS || method == HttpMethod.TRACE || method == HttpMethod.CONNECT || method == HttpMethod.DELETE;
    }

    private rewriteBufferIfNeed() : void {
        if(this._buffer.length > 0) {
            this.write(EMPTY_BUFFER);
        }
    }

    public write (buffer: Buffer) : void {

        try {
            this._buffer = Buffer.concat([this._buffer, buffer]);
            if (this._state == ParseState.SEARCHING_FOR_HEADER) {
                this._header  = this.parseHeader();
                if (!this._header) {
                    return;
                }
                if(!this._onHeaderCallback) {
                    return;
                }

                this._onHeaderCallback?.(this._header);
                if (this._header.upgrade) {
                    this._state = ParseState.UPGRADE;
                } else if (this._header.chunked) {
                    this._state = ParseState.CHUNKED_SIZE;
                } else if (this._header.contentLength > 0) {
                    this._state = ParseState.CONTENT_LENGTH_BODY;
                } else if(this._header.contentLength == 0) {
                    this.setEnd();
                }
                else if(this._header.type == MessageType.Request && this.isNoneBodyMethod(this._header.method)) {
                    this.setEnd();
                    return;
                }
                else {
                    this.setEnd();
                    //this._state = ParseState.UNKNOWN_LENGTH_BODY;
                }

            } else if (this._state == ParseState.CHUNKED_SIZE) {
                let result = this.readChunkedSize();
                if (result == ReadResult.End || result == ReadResult.Closed) {
                    return;
                }
                this._state = ParseState.CHUNKED_DATA;
            } else if (this._state == ParseState.CHUNKED_DATA) {
                let result = this.readChunkedData();
                if (result == ReadResult.Closed || result == ReadResult.End) {
                    return;
                }
            } else if (this._state == ParseState.CONTENT_LENGTH_BODY) {
                let result = this.readBodyInContentLengthMode(this._header!.contentLength);
                if (result == ReadResult.Closed || result == ReadResult.End) {
                    return;
                }
            } else if (this._state == ParseState.UNKNOWN_LENGTH_BODY || this._state == ParseState.UPGRADE) {
                /*let buffer = this.readBodyInUnknownLengthMode();
                if (buffer == null) {
                    return;
                }
                if(!this._onDataCallback || !this._onDataCallback?.(buffer)) {
                    return;
                }*/
                this._onErrorCallback?.(new Error('Content length unknown'));
            }
            if(!this._onDataCallback) {
                return;
            }
            this._recursiveCallLevel++;
            if(this._recursiveCallLevel > MAX_RECURSIVE_CALL_LEVEL) {
                this._recursiveCallLevel = 0;
                process.nextTick(()=>this.rewriteBufferIfNeed());
            } else {
                this.rewriteBufferIfNeed();
            }



        } catch (err: Error | any) {
            if(err instanceof Error) {
                this._onErrorCallback?.(err);
            } else {
                throw err;
            }
        }
        this._lastRead = Date.now();
    }

    public checkTimeout() : void {
        if(this._lastRead == -1 || this._state == ParseState.END || this._state == ParseState.UPGRADE) {
            return;
        }
        else if(Date.now() - this._lastRead > this._readTimeout) {
            this._onErrorCallback?.(new Error('Timeout'));
        }
    }

    private bufferToHttpHeader(buffer: Buffer) : HttpResponseHeader | HttpRequestHeader {
        let bufferList : Array<Buffer> = this.splitHeaderBuffer(buffer);
        let firstLine = bufferList.shift();
        let isRequest : boolean = this._messageType == MessageType.Request;
        if(firstLine == null) {
            throw new Error(`Invalid ${isRequest ? 'request' : 'response'} header`);
        }
        let headerInfo : RequestInfo | ResponseInfo = isRequest ? this.parseRequestHeader(firstLine) : this.parseResponseHeader(firstLine);
        let nameValueList : Array<NameValue> = this.parseHeaderList(bufferList);
        let httpHeader : HttpHeader = {
            headers: nameValueList,
            contentLength: -1,
            upgrade: false,
            chunked: false
        }
        return Object.assign(httpHeader, headerInfo);
    }

    private findAndSetLengthValue(header: HttpHeader) : void {
        header.headers.forEach((nameValue) => {
            if(nameValue.name.toLowerCase() == 'content-length') {
                header.contentLength = parseInt(nameValue.value);
            } else if(nameValue.name.toLowerCase() == 'transfer-encoding') {
                header.chunked = nameValue.value.toLowerCase() == 'chunked';
            } else if(nameValue.name.toLowerCase() == 'upgrade') {
                header.upgrade = true;
            }
        });
    }

    private assertFirstLineForResponse(buffer: Buffer) : void {
        let idx = buffer.indexOf(" ");
        if(idx < 0) {
            if(buffer.length > 8)  {
                throw new Error(`Invalid response header`);
            }
        }
        buffer = buffer.subarray(0, idx);
        let str = buffer.toString();
        if(str != 'HTTP/1.0' && str != 'HTTP/1.1' && str != 'http/1.0' && str != 'http/1.1') {
            throw new Error(`Invalid response header: ${str}`);
        }
    }

    private assertFirstLineForRequest(buffer: Buffer) : void {
        let idx = buffer.indexOf(" ");
        if(idx < 0) {
            if(buffer.length > 7)  {
                throw new Error(`Invalid request header`);
            }
        }
        buffer = buffer.subarray(0, idx);
        let str = buffer.toString();
        this.methodStringToMethod(str);
    }




    private parseHeader() : HttpResponseHeader | HttpRequestHeader | null {
        if(this._messageType == MessageType.Response)
            this.assertFirstLineForResponse(this._buffer);
        else
            this.assertFirstLineForRequest(this._buffer);

        let idx = this._buffer.indexOf("\r\n\r\n");
        if (idx < 0) {
            return null;
        }
        if(idx > this._maxHeaderSize) {
            throw new Error(`Header too large. Max size is ${this._maxHeaderSize} bytes`)
        }
        this._state = ParseState.HEADER;
        let headerBuffer = this._buffer.subarray(0, idx);
        this._buffer = this._buffer.subarray(idx + 4);
        let header : HttpRequestHeader | HttpResponseHeader = this.bufferToHttpHeader(headerBuffer);
        this.findAndSetLengthValue(header);
        return header;
    }



    private readBodyInContentLengthMode(contentLength: number) :  ReadResult {
        let readable = contentLength - this._contentLengthRead;
        if(this._buffer.length < readable) {
            if(!this._onDataCallback  || !this._onDataCallback?.(this._buffer)) {
                return ReadResult.Closed;
            }
            this._contentLengthRead += this._buffer.length;
            this._buffer = Buffer.alloc(0);
            return ReadResult.End;
        }
        let bodyBuffer = this._buffer.subarray(0, readable);
        this._buffer = this._buffer.subarray(readable);
        this._contentLengthRead += readable;
        if(!this._onDataCallback  || !this._onDataCallback?.(bodyBuffer)) {
            return ReadResult.Closed;
        }
        if(this._contentLengthRead == contentLength) {
            this.setEnd();
        } else if(this._contentLengthRead > contentLength) {
            // This should never happen ^_^;;f
            throw new Error(`Invalid content length. Expected ${contentLength} bytes but got ${this._contentLengthRead} bytes`);
        }
        return ReadResult.Continue;
    }

    private readBodyInUnknownLengthMode() : Buffer | null {
        let buffer = this._buffer;
        this._buffer = Buffer.alloc(0);
        return buffer;
    }



    private readChunkedSize() : ReadResult {
        let idx = this._buffer.indexOf(CRLF_BUFFER)
        if(idx == 0) {
            this._buffer = this._buffer.subarray(2);
            idx = this._buffer.indexOf(CRLF_BUFFER);
        }
        if(idx == 0) {
            return ReadResult.Closed;
        }

        if(idx < 0) {
            return ReadResult.End;
        }
        let chunkedSizeBuffer = this._buffer.subarray(0, idx);

        this._chunkedSize = parseInt(chunkedSizeBuffer.toString(), 16);
        if(isNaN(this._chunkedSize)) {
            throw new Error(`Invalid chunked size ${chunkedSizeBuffer.toString()}`);
        }
        this._chunkedSizeRead = 0;

        this._state = ParseState.CHUNKED_DATA;
        if(!this._deliverPureData) {
            let sendSuccess = this._onDataCallback && !this._onDataCallback?.(chunkedSizeBuffer);
            if(!sendSuccess) {
                return ReadResult.Closed;
            }
            sendSuccess = this._onDataCallback && !this._onDataCallback?.(CRLF_BUFFER);
            if(!sendSuccess) {
                return ReadResult.Closed;
            }
        }

        this._buffer = this._buffer.subarray(idx + 2);
        return ReadResult.Continue;
    }

    private readChunkedData() : ReadResult {
        let readable = this._chunkedSize - this._chunkedSizeRead;
        if(this._chunkedSize == 0) {
            if(this._buffer.length >= 2) {
                this._buffer = this._buffer.subarray(2);
                if(!this._deliverPureData) {
                    let sendSuccess = this._onDataCallback && !this._onDataCallback?.(CRLF_BUFFER);
                    if(!sendSuccess) {
                        return ReadResult.Closed;
                    }
                }
                this.setEnd();
                return ReadResult.Continue;
            }
            return ReadResult.End;
        }
        else if(this._buffer.length < readable) {
            return ReadResult.End;
        }
        let chunkedDataBuffer = this._buffer.subarray(0, readable);
        this._buffer = this._buffer.subarray(readable);
        this._chunkedSizeRead += chunkedDataBuffer.length;
        if(this._chunkedSizeRead == this._chunkedSize) {
            let leftChunkIdx =  this._buffer.indexOf(CRLF_BUFFER);
            if(leftChunkIdx > 0) {
                throw new Error(`Invalid chunked data. Expected ${this._chunkedSize} bytes but got ${this._chunkedSizeRead} bytes`);
            } else if(leftChunkIdx <= 0) {
                /*if(leftChunkIdx == 0) {
                    this._buffer = this._buffer.subarray(2);
                } else {
                    this._buffer = Buffer.alloc(0);
                }*/
                this._state = ParseState.CHUNKED_SIZE;
                if(!this._deliverPureData) {
                    chunkedDataBuffer = Buffer.concat([chunkedDataBuffer, CRLF_BUFFER]);
                }
            }

        } else if(this._chunkedSizeRead > this._chunkedSize) {
            // Should never happen. ^_^;;
            throw new Error(`Chunked data read too much. Expected ${this._chunkedSize} bytes, read ${this._chunkedSizeRead} bytes`);
        }
        if(!this._onDataCallback || !this._onDataCallback?.(chunkedDataBuffer)) {
            return ReadResult.Closed;
        }
        return ReadResult.Continue;
    }


    private parseResponseHeader(firstLine: Buffer) : ResponseInfo {
        let firstLineList = this.splitFirstLine(firstLine);
        let version = firstLineList[0];
        let status = parseInt(firstLineList[1]);
        let statusText = firstLineList[2];
        return { type: MessageType.Response, version: version, status: status, statusText: statusText };
    }

    private parseRequestHeader(firstLine: Buffer) : RequestInfo {
        let firstLineList = this.splitFirstLine(firstLine);
        let method = this.methodStringToMethod(firstLineList[0]);
        let path = firstLineList[1];
        let version = firstLineList[2];
        return { type: MessageType.Request, method: method, path: path, version: version};
    }

    private splitFirstLine(firstLine: Buffer) : Array<string> {
        let firstLineStr = firstLine.toString();
        let firstLineList = firstLineStr.split(" ");
        if(firstLineList.length < 3) {
            throw new Error("Invalid request header");
        }
        return firstLineList;
    }

    private methodStringToMethod(method: string) : HttpMethod {
        method = method.toUpperCase();
        switch(method) {
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


    private splitHeaderBuffer(header: Buffer) : Array<Buffer> {
        let headerList : Array<Buffer> = [];
        let start = 0;
        let end = 0;
        while(true) {
            end = header.indexOf("\r\n", start);
            if(end < 0) {
                break;
            }
            headerList.push(header.subarray(start, end));
            start = end + 2;
        }
        headerList.push(header.subarray(start));

        return headerList;
    }

    private parseHeaderList(headerList: Array<Buffer>) : Array<NameValue> {
        let nameValueList : Array<NameValue> = [];
        for(let header of headerList) {
            let idx = header.indexOf(":");
            if(idx < 0) {
                continue;
            }
           let name = header.subarray(0, idx).toString();
           let value = header.subarray(idx + 1).toString();
           nameValueList.push({name: name.trim(), value: value.trim()});
        }
        return nameValueList;
    }

    private setEnd() {
        this._header = null;
        this._state = ParseState.END;
        this._onEndCallback?.();
    }
}


export {HttpPipe, NameValue, HttpResponseHeader, HttpRequestHeader, HttpMethod, MessageType,HttpHeader}
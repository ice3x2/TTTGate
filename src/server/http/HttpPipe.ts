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
    CHUNKED_TRAILER,
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
    chunked: boolean,
    keepAlive: boolean,
    connection: string
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
const DOUBLE_CRLF_BUFFER = Buffer.from("\r\n\r\n");

enum ReadResult {
    Continue,
    Closed,
    End
}

const MAX_RECURSIVE_CALL_LEVEL = 1000;
const MAX_HEADER_SIZE = 8 * 1024 * 1024; // 8MB 최대 헤더 크기

class HttpPipe {
    private _buffer: Buffer = Buffer.alloc(0);
    private _header: HttpRequestHeader | HttpResponseHeader | null = null;

    private _state: ParseState = ParseState.SEARCHING_FOR_HEADER;
    private _maxHeaderSize: number = MAX_HEADER_SIZE;
    private _messageType: MessageType = MessageType.Request;
    private _chunkedSize: number = 0;
    private _chunkedSizeRead: number = 0;
    private _contentLengthRead: number = 0;
    private _deliverPureData: boolean = false;
    private _recursiveCallLevel: number = 0;
    private _trailerHeaders: Array<NameValue> = [];

    private _onErrorCallback?: OnError;
    private _onDataCallback?: OnData;
    private _onEndCallback?: OnEnd;
    private _onHeaderCallback?: OnHeader;

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

    public static createHttpRequestPipe(): HttpPipe {
        let pipe = new HttpPipe();
        pipe._messageType = MessageType.Request;
        return pipe;
    }

    public setDeliverPureData(enable: boolean) {
        this._deliverPureData = enable;
    }

    public get messageType(): MessageType {
        return this._messageType;
    }

    public get bufferSize(): number {
        return this._buffer.length;
    }

    public constructor() {}

    public reset(messageType: MessageType): void {
        this._deliverPureData = false;
        this._messageType = messageType;
        this._buffer = Buffer.alloc(0);
        this._state = ParseState.SEARCHING_FOR_HEADER;
        this._chunkedSize = 0;
        this._chunkedSizeRead = 0;
        this._contentLengthRead = 0;
        this._trailerHeaders = [];
        this._header = null;
    }

    private isNoneBodyMethod(method: HttpMethod): boolean {
        return method == HttpMethod.GET || method == HttpMethod.HEAD || method == HttpMethod.OPTIONS || 
               method == HttpMethod.TRACE || method == HttpMethod.CONNECT || method == HttpMethod.DELETE;
    }

    private rewriteBufferIfNeed(): void {
        if(this._buffer.length > 0) {
            this.write(EMPTY_BUFFER);
        }
    }

    public write(buffer: Buffer): void {
        try {
            this._buffer = Buffer.concat([this._buffer, buffer]);
            
            if (this._state == ParseState.SEARCHING_FOR_HEADER) {
                this._header = this.parseHeader();
                if (!this._header) {
                    // 헤더 크기 확인 - 헤더 크기 제한 초과 감지
                    if (this._buffer.length > this._maxHeaderSize) {
                        throw new Error(`Header too large: ${this._buffer.length} bytes exceeds limit of ${this._maxHeaderSize} bytes`);
                    }
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
                    // HTTP/1.0은 Content-Length가 없으면 연결 종료 시점까지가 본문임
                    // HTTP/1.1은 Content-Length가 없고 Chunked가 아니면 원칙적으로 본문이 없음
                    if (this._header.version === "HTTP/1.0") {
                        this._state = ParseState.UNKNOWN_LENGTH_BODY;
                    } else {
                        this.setEnd();
                    }
                }
            } else if (this._state == ParseState.CHUNKED_SIZE) {
                let result = this.readChunkedSize();
                if (result == ReadResult.End || result == ReadResult.Closed) {
                    return;
                }
                // chunked size가 0이면 chunked 종료, trailer 헤더 확인
                if (this._chunkedSize == 0) {
                    this._state = ParseState.CHUNKED_TRAILER;
                } else {
                    this._state = ParseState.CHUNKED_DATA;
                }
            } else if (this._state == ParseState.CHUNKED_DATA) {
                let result = this.readChunkedData();
                if (result == ReadResult.Closed || result == ReadResult.End) {
                    return;
                }
            } else if (this._state == ParseState.CHUNKED_TRAILER) {
                let result = this.readChunkedTrailer();
                if (result == ReadResult.Closed || result == ReadResult.End) {
                    return;
                }
            } else if (this._state == ParseState.CONTENT_LENGTH_BODY) {
                let result = this.readBodyInContentLengthMode(this._header!.contentLength);
                if (result == ReadResult.Closed || result == ReadResult.End) {
                    return;
                }
            } else if (this._state == ParseState.UNKNOWN_LENGTH_BODY) {
                let buffer = this.readBodyInUnknownLengthMode();
                if (buffer === null || buffer.length === 0) {
                    return;
                }
                if(!this._onDataCallback || !this._onDataCallback?.(buffer)) {
                    return;
                }
            } else if (this._state == ParseState.UPGRADE) {
                // WebSocket이나 다른 프로토콜로 업그레이드된 상태에서는 데이터를 그대로 전달
                let buffer = this._buffer;
                this._buffer = Buffer.alloc(0);
                if (buffer.length > 0) {
                    if (!this._onDataCallback || !this._onDataCallback?.(buffer)) {
                        return;
                    }
                }
                return;
            }
            
            if (!this._onDataCallback) {
                return;
            }
            
            this._recursiveCallLevel++;
            if (this._recursiveCallLevel > MAX_RECURSIVE_CALL_LEVEL) {
                this._recursiveCallLevel = 0;
                process.nextTick(() => this.rewriteBufferIfNeed());
            } else {
                this.rewriteBufferIfNeed();
            }
        } catch (err: Error | any) {
            if (err instanceof Error) {
                this._onErrorCallback?.(err);
            } else {
                this._onErrorCallback?.(new Error(String(err)));
            }
        }
    }

    private bufferToHttpHeader(buffer: Buffer): HttpResponseHeader | HttpRequestHeader {
        let bufferList: Array<Buffer> = this.splitHeaderBuffer(buffer);
        let firstLine = bufferList.shift();
        let isRequest: boolean = this._messageType == MessageType.Request;
        
        if (firstLine == null) {
            throw new Error(`Invalid ${isRequest ? 'request' : 'response'} header`);
        }
        
        let headerInfo: RequestInfo | ResponseInfo = isRequest ? 
            this.parseRequestHeader(firstLine) : this.parseResponseHeader(firstLine);
        
        let nameValueList: Array<NameValue> = this.parseHeaderList(bufferList);
        
        let httpHeader: HttpHeader = {
            headers: nameValueList,
            contentLength: -1,
            upgrade: false,
            chunked: false,
            keepAlive: false,
            connection: ""
        }
        
        return Object.assign(httpHeader, headerInfo);
    }

    private findAndSetLengthValue(header: HttpHeader): void {
        header.headers.forEach((nameValue) => {
            const name = nameValue.name.toLowerCase();
            if (name === 'content-length') {
                header.contentLength = parseInt(nameValue.value);
            } else if (name === 'transfer-encoding') {
                header.chunked = nameValue.value.toLowerCase().includes('chunked');
            } else if (name === 'upgrade') {
                header.upgrade = true;
            } else if (name === 'connection') {
                header.connection = nameValue.value.toLowerCase();
                // Connection 헤더 값 검사
                const connectionValues = nameValue.value.toLowerCase().split(',').map(s => s.trim());
                header.keepAlive = connectionValues.includes('keep-alive');
                header.upgrade = header.upgrade || connectionValues.includes('upgrade');
            }
        });


        const requestHeader = header as HttpRequestHeader;
        // HTTP 버전에 따른 기본 Connection 값 설정
        if (requestHeader.type === MessageType.Request) {
            // HTTP/1.1은 기본적으로 keep-alive
            if (requestHeader.version === 'HTTP/1.1' && header.connection === "") {
                header.keepAlive = true;
            }
            // HTTP/1.0은 기본적으로 close
            else if (requestHeader.version === 'HTTP/1.0' && header.connection === "") {
                header.keepAlive = false;
            }
        } else if (requestHeader.type === MessageType.Response) {
            const responseHeader = header as HttpResponseHeader;
            // HTTP/1.1은 기본적으로 keep-alive
            if (responseHeader.version === 'HTTP/1.1' && header.connection === "") {
                header.keepAlive = true;
            }
        }
    }

    private assertFirstLineForResponse(buffer: Buffer): void {
        let idx = buffer.indexOf(" ");
        if (idx < 0) {
            if (buffer.length > 8) {
                throw new Error(`Invalid response header`);
            }
            return; // 버퍼가 아직 충분하지 않음
        }
        
        buffer = buffer.subarray(0, idx);
        let str = buffer.toString().toUpperCase();
        
        if (str !== 'HTTP/1.0' && str !== 'HTTP/1.1' && str !== 'HTTP/2.0') {
            throw new Error(`Invalid response protocol: ${str}`);
        }
    }

    private assertFirstLineForRequest(buffer: Buffer): void {
        let idx = buffer.indexOf(" ");
        if (idx < 0) {
            if (buffer.length > 7) {
                throw new Error(`Invalid request header`);
            }
            return; // 버퍼가 아직 충분하지 않음
        }
        
        buffer = buffer.subarray(0, idx);
        let str = buffer.toString().toUpperCase();
        
        try {
            this.methodStringToMethod(str);
        } catch (e) {
            throw new Error(`Invalid request method: ${str}`);
        }
    }

    private parseHeader(): HttpResponseHeader | HttpRequestHeader | null {
        try {
            if (this._messageType == MessageType.Response) {
                this.assertFirstLineForResponse(this._buffer);
            } else {
                this.assertFirstLineForRequest(this._buffer);
            }
        } catch (e) {
            // 아직 완전한 헤더가 아니라면 그냥 반환
            if (this._buffer.length <= 8) {
                return null;
            }
            throw e; // 실제 에러면 전파
        }

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
        
        let header: HttpRequestHeader | HttpResponseHeader = this.bufferToHttpHeader(headerBuffer);
        this.findAndSetLengthValue(header);
        
        return header;
    }

    private readBodyInContentLengthMode(contentLength: number): ReadResult {
        let readable = contentLength - this._contentLengthRead;
        
        if (this._buffer.length < readable) {
            if (!this._onDataCallback || !this._onDataCallback?.(this._buffer)) {
                return ReadResult.Closed;
            }
            
            this._contentLengthRead += this._buffer.length;
            this._buffer = Buffer.alloc(0);
            
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
        } else if (this._contentLengthRead > contentLength) {
            throw new Error(`Invalid content length. Expected ${contentLength} bytes but got ${this._contentLengthRead} bytes`);
        }
        
        return ReadResult.Continue;
    }

    private readBodyInUnknownLengthMode(): Buffer | null {
        if (this._buffer.length === 0) {
            return null;
        }
        
        let buffer = this._buffer;
        this._buffer = Buffer.alloc(0);
        
        return buffer;
    }

    private readChunkedSize(): ReadResult {
        // 개행을 찾음
        let idx = this._buffer.indexOf(CRLF_BUFFER);
        
        // 첫 번째 개행이 비어있으면 건너뜀 (이전 청크의 끝부분일 수 있음)
        if (idx === 0) {
            this._buffer = this._buffer.subarray(2);
            idx = this._buffer.indexOf(CRLF_BUFFER);
        }
        
        if (idx === 0) {
            return ReadResult.Closed;
        }
        
        if (idx < 0) {
            return ReadResult.End; // 아직 완전한 chunked 크기가 없음
        }
        
        let chunkedSizeBuffer = this._buffer.subarray(0, idx);
        let sizeText = chunkedSizeBuffer.toString().trim();
        
        // 청크 크기에서 확장 부분 제거 (';' 이후 내용 무시)
        const semicolonIndex = sizeText.indexOf(';');
        if (semicolonIndex !== -1) {
            sizeText = sizeText.substring(0, semicolonIndex).trim();
        }
        
        this._chunkedSize = parseInt(sizeText, 16);
        
        if (isNaN(this._chunkedSize)) {
            throw new Error(`Invalid chunked size: '${sizeText}'`);
        }
        
        this._chunkedSizeRead = 0;
        
        if (!this._deliverPureData) {
            let sendSuccess = this._onDataCallback && this._onDataCallback?.(chunkedSizeBuffer);
            if (!sendSuccess) {
                return ReadResult.Closed;
            }
            
            sendSuccess = this._onDataCallback && this._onDataCallback?.(CRLF_BUFFER);
            if (!sendSuccess) {
                return ReadResult.Closed;
            }
        }
        
        this._buffer = this._buffer.subarray(idx + 2);
        
        return ReadResult.Continue;
    }

    private readChunkedData(): ReadResult {
        let readable = this._chunkedSize - this._chunkedSizeRead;
        
        // 마지막 청크는 크기가 0
        if (this._chunkedSize === 0) {
            if (this._buffer.length >= 2) {
                this._buffer = this._buffer.subarray(2);
                
                if (!this._deliverPureData) {
                    let sendSuccess = this._onDataCallback && this._onDataCallback?.(CRLF_BUFFER);
                    if (!sendSuccess) {
                        return ReadResult.Closed;
                    }
                }
                
                // 마지막 청크 이후 선택적 trailer 헤더가 올 수 있음
                this._state = ParseState.CHUNKED_TRAILER;
                return ReadResult.Continue;
            }
            return ReadResult.End;
        }
        
        // 버퍼에 충분한 데이터가 없음
        if (this._buffer.length < readable) {
            return ReadResult.End;
        }
        
        let chunkedDataBuffer = this._buffer.subarray(0, readable);
        this._buffer = this._buffer.subarray(readable);
        this._chunkedSizeRead += chunkedDataBuffer.length;
        
        if (this._chunkedSizeRead == this._chunkedSize) {
            // 청크 데이터 이후에는 CRLF가 와야 함
            if (this._buffer.length >= 2) {
                // CRLF 확인
                if (this._buffer[0] !== 13 || this._buffer[1] !== 10) {
                    throw new Error('Missing CRLF after chunk data');
                }
                
                this._buffer = this._buffer.subarray(2);
                this._state = ParseState.CHUNKED_SIZE;
                
                if (!this._deliverPureData) {
                    chunkedDataBuffer = Buffer.concat([chunkedDataBuffer, CRLF_BUFFER]);
                }
            } else {
                // 아직 CRLF를 받지 못함
                return ReadResult.End;
            }
        } else if (this._chunkedSizeRead > this._chunkedSize) {
            throw new Error(`Chunked data read too much. Expected ${this._chunkedSize} bytes, read ${this._chunkedSizeRead} bytes`);
        }
        
        if (!this._onDataCallback || !this._onDataCallback?.(chunkedDataBuffer)) {
            return ReadResult.Closed;
        }
        
        return ReadResult.Continue;
    }

    private readChunkedTrailer(): ReadResult {
        // trailer 헤더 확인
        if (this._buffer.length < 2) {
            return ReadResult.End;
        }
        
        // 빈 줄이면(CRLF만 있으면) 청크 전송 완료
        if (this._buffer[0] === 13 && this._buffer[1] === 10) {
            this._buffer = this._buffer.subarray(2);
            this.setEnd();
            return ReadResult.Continue;
        }
        
        // trailer 헤더가 있는 경우 파싱
        let trailerEnd = this._buffer.indexOf(DOUBLE_CRLF_BUFFER);
        if (trailerEnd === -1) {
            // 아직 trailer의 끝을 찾지 못함
            if (this._buffer.length > this._maxHeaderSize) {
                throw new Error('Trailer headers too large');
            }
            return ReadResult.End;
        }
        
        // trailer 헤더 파싱
        let trailerBuffer = this._buffer.subarray(0, trailerEnd);
        this._buffer = this._buffer.subarray(trailerEnd + 4);
        
        // trailer 헤더 처리
        let trailerLines = this.splitHeaderBuffer(trailerBuffer);
        this._trailerHeaders = this.parseHeaderList(trailerLines);
        
        // HTTP 헤더에 trailer 추가 (선택적)
        if (this._header && this._trailerHeaders.length > 0) {
            this._header.headers = [...this._header.headers, ...this._trailerHeaders];
        }
        
        this.setEnd();
        
        return ReadResult.Continue;
    }

    private parseResponseHeader(firstLine: Buffer): ResponseInfo {
        let firstLineList = this.splitFirstLine(firstLine);
        
        if (firstLineList.length < 3) {
            throw new Error('Invalid response header format');
        }
        
        let version = firstLineList[0];
        let status = parseInt(firstLineList[1]);
        
        if (isNaN(status)) {
            throw new Error(`Invalid status code: ${firstLineList[1]}`);
        }
        
        // 상태 텍스트가 여러 단어로 구성될 수 있으므로 나머지 부분을 모두 결합
        let statusText = firstLineList.slice(2).join(' ');
        
        return { type: MessageType.Response, version: version, status: status, statusText: statusText };
    }

    private parseRequestHeader(firstLine: Buffer): RequestInfo {
        let firstLineList = this.splitFirstLine(firstLine);
        
        if (firstLineList.length < 3) {
            throw new Error('Invalid request header format');
        }
        
        let method = this.methodStringToMethod(firstLineList[0]);
        let path = firstLineList[1];
        let version = firstLineList[2];
        
        return { type: MessageType.Request, method: method, path: path, version: version };
    }

    private splitFirstLine(firstLine: Buffer): Array<string> {
        let firstLineStr = firstLine.toString();
        // HTTP 요청/응답 첫 줄은 공백으로 분리
        let firstLineList = firstLineStr.split(" ");
        
        if (firstLineList.length < 3) {
            throw new Error("Invalid header format");
        }
        
        return firstLineList;
    }

    private methodStringToMethod(method: string): HttpMethod {
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
            default: throw new Error(`Invalid HTTP method: ${method}`);
        }
    }

    private splitHeaderBuffer(header: Buffer): Array<Buffer> {
        let headerList: Array<Buffer> = [];
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
        
        if (start < header.length) {
            headerList.push(header.subarray(start));
        }
        
        return headerList;
    }

    private parseHeaderList(headerList: Array<Buffer>): Array<NameValue> {
        let nameValueList: Array<NameValue> = [];
        let currentHeader: NameValue | null = null;
        
        for (let i = 0; i < headerList.length; i++) {
            let header = headerList[i];
            
            // 빈 헤더 라인은 건너뜀
            if (header.length === 0) {
                continue;
            }
            
            // 연속 헤더 처리 (첫 문자가 공백/탭이면 이전 헤더의 계속)
            if (header[0] === 32 || header[0] === 9) { // 32: 공백, 9: 탭
                if (currentHeader) {
                    currentHeader.value += ' ' + header.toString().trim();
                }
                continue;
            }
            
            // 새 헤더
            let idx = header.indexOf(":");
            if (idx < 0) {
                continue; // 유효하지 않은 헤더 라인은 무시
            }
            
            let name = header.subarray(0, idx).toString().trim();
            let value = header.subarray(idx + 1).toString().trim();
            
            currentHeader = { name, value };
            nameValueList.push(currentHeader);
        }
        
        return nameValueList;
    }

    private setEnd() {
        this._state = ParseState.END;
        this._onEndCallback?.();
    }
}

export {
    HttpPipe, 
    NameValue, 
    HttpResponseHeader, 
    HttpRequestHeader, 
    HttpMethod, 
    MessageType, 
    HttpHeader,
    ParseState
}
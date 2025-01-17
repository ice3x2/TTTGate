/// <reference types="node" />
import { Buffer } from "buffer";
declare enum HttpMethod {
    GET = 0,
    POST = 1,
    PUT = 2,
    DELETE = 3,
    HEAD = 4,
    OPTIONS = 5,
    TRACE = 6,
    CONNECT = 7,
    PATCH = 8
}
interface NameValue {
    name: string;
    value: string;
}
type OnError = (err: Error) => void;
type OnData = (data: Buffer) => boolean;
type OnEnd = () => void;
type OnHeader = (header: HttpRequestHeader | HttpResponseHeader) => void;
type HttpHeader = {
    headers: Array<NameValue>;
    contentLength: number;
    upgrade: boolean;
    chunked: boolean;
};
declare enum MessageType {
    Request = 0,
    Response = 1
}
type RequestInfo = {
    type: MessageType.Request;
    method: HttpMethod;
    path: string;
    version: string;
};
type ResponseInfo = {
    type: MessageType.Response;
    version: string;
    status: number;
    statusText: string;
};
type HttpRequestHeader = HttpHeader & RequestInfo;
type HttpResponseHeader = HttpHeader & ResponseInfo;
declare class HttpPipe {
    private _buffer;
    private _header;
    private _state;
    private _maxHeaderSize;
    private _messageType;
    private _chunkedSize;
    private _chunkedSizeRead;
    private _contentLengthRead;
    private _deliverPureData;
    private _recursiveCallLevel;
    private _onErrorCallback?;
    private _onDataCallback?;
    private _onEndCallback?;
    private _onHeaderCallback?;
    set onErrorCallback(callback: OnError);
    set onDataCallback(callback: OnData);
    set onEndCallback(callback: OnEnd);
    set onHeaderCallback(callback: OnHeader);
    static createHttpRequestPipe(): HttpPipe;
    setDeliverPureData(enable: boolean): void;
    get messageType(): MessageType;
    get bufferSize(): number;
    constructor();
    reset(messageType: MessageType): void;
    private isNoneBodyMethod;
    private rewriteBufferIfNeed;
    write(buffer: Buffer): void;
    private bufferToHttpHeader;
    private findAndSetLengthValue;
    private assertFirstLineForResponse;
    private assertFirstLineForRequest;
    private parseHeader;
    private readBodyInContentLengthMode;
    private readBodyInUnknownLengthMode;
    private readChunkedSize;
    private readChunkedData;
    private parseResponseHeader;
    private parseRequestHeader;
    private splitFirstLine;
    private methodStringToMethod;
    private splitHeaderBuffer;
    private parseHeaderList;
    private setEnd;
}
export { HttpPipe, NameValue, HttpResponseHeader, HttpRequestHeader, HttpMethod, MessageType, HttpHeader };

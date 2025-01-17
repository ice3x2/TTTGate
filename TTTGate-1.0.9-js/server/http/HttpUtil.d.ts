/// <reference types="node" />
import { HttpHeader, HttpRequestHeader, HttpResponseHeader, NameValue } from "./HttpPipe";
declare class HttpUtil {
    static convertHttpHeaderToBuffer(header: HttpRequestHeader | HttpResponseHeader): Buffer;
    static findHeaderValue(httpHeader: HttpHeader, name: string): string | null;
    static removeHeader(httpHeader: HttpHeader, name: string): void;
    static findHeader(httpHeader: HttpHeader, name: string): NameValue | null;
    static findHeaders(httpHeader: HttpHeader, name: string): Array<NameValue>;
    static isTextContentType(httpHeader: HttpHeader): boolean;
    static isChunked(httpHeader: HttpHeader): boolean;
    static uncompressBody(contentEncoding: string | null, body: Buffer): Buffer;
    static compressBody(contentEncoding: string | null, body: Buffer): Buffer;
    static gzip(body: Buffer): Buffer;
    static deflate(body: Buffer): Buffer;
    static gunzip(body: Buffer): Buffer;
    static inflate(body: Buffer): Buffer;
}
export default HttpUtil;

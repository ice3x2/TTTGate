import {HttpHeader, HttpMethod, HttpRequestHeader, HttpResponseHeader, MessageType, NameValue} from "./HttpPipe";
import zlib from  "zlib";
class HttpUtil {
    public static convertHttpHeaderToBuffer(header: HttpRequestHeader | HttpResponseHeader) : Buffer {
        let lines: Array<string> = [];
        if(header.type == MessageType.Request) {
            lines.push(`${HttpMethod[header.method]} ${header.path} ${header.version}`);
        } else {
            lines.push(`${header.version} ${header.status} ${header.statusText}`);
        }
        for (let i = 0; i < header.headers.length; i++) {
            let nameValue = header.headers[i];
            lines.push(`${nameValue.name}: ${nameValue.value}`);
        }
        lines.push("\r\n");
        return Buffer.from(lines.join("\r\n"));

    }

    public static findHeaderValue(httpHeader: HttpHeader, name: string) : string | null {
        let nameValue = HttpUtil.findHeader(httpHeader, name);
        if(nameValue != null) {
            return nameValue.value;
        }
        return null;
    }

    public static removeHeader(httpHeader: HttpHeader, name: string) : void {
        for (let i = 0; i < httpHeader.headers.length; i++) {
            let nameValue = httpHeader.headers[i];
            if(nameValue.name.toLowerCase() == name.toLowerCase()) {
                httpHeader.headers.splice(i,1);
                return;
            }
        }
    }

    public static findHeader(httpHeader: HttpHeader, name: string) : NameValue | null {
        for (let i = 0; i < httpHeader.headers.length; i++) {
            let nameValue = httpHeader.headers[i];
            if(nameValue.name.toLowerCase() == name.toLowerCase()) {
                return nameValue;
            }
        }
        return null;
    }

    public static findHeaders(httpHeader: HttpHeader, name: string) : Array<NameValue>  {
        let result : Array<NameValue> = [];
        for (let i = 0; i < httpHeader.headers.length; i++) {
            let nameValue = httpHeader.headers[i];
            if(nameValue.name.toLowerCase() == name.toLowerCase()) {
                result.push(nameValue);
            }
        }
        return result;
    }

    public static isTextContentType(httpHeader: HttpHeader) : boolean {
        let contentType = HttpUtil.findHeader(httpHeader, "Content-Type");
        if(contentType != null) {
            return contentType.value.indexOf("text/") > -1 || contentType.value.indexOf("application/json") > -1 || contentType.value.indexOf("application/javascript") > -1 || contentType.value.indexOf("application/xml") > -1;
        }
        return false;
    }



    public static isChunked(httpHeader: HttpHeader) : boolean {
        let transferEncoding = HttpUtil.findHeader(httpHeader, "Transfer-Encoding");
        if(transferEncoding != null) {
            return transferEncoding.value.toLowerCase() == "chunked";
        }
        return false;
    }

    public static uncompressBody(contentEncoding: string | null, body: Buffer) : Buffer {
        if(contentEncoding != null) {
            contentEncoding = contentEncoding.toLowerCase();
            if(contentEncoding == "gzip") {
                return HttpUtil.gunzip(body);
            } else if(contentEncoding == "deflate") {
                return HttpUtil.inflate(body);
            }
        }
        return body;
    }

    public static compressBody(contentEncoding: string | null, body: Buffer) : Buffer {
        if(contentEncoding != null) {
            if(contentEncoding == "gzip") {
                return HttpUtil.gzip(body);
            } else if(contentEncoding == "deflate") {
                return HttpUtil.deflate(body);
            }
        }
        return body;
    }

    public static gzip(body: Buffer) : Buffer {
        return zlib.gzipSync(body);
    }

    public static deflate(body: Buffer) : Buffer {
        return zlib.deflateSync(body);
    }

    public static gunzip(body: Buffer) : Buffer {
        return zlib.gunzipSync(body);
    }

    public static inflate(body: Buffer) : Buffer {
        return zlib.inflateSync(body);
    }


}

export default HttpUtil;
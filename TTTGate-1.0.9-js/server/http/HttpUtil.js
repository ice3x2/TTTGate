"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const HttpPipe_1 = require("./HttpPipe");
const zlib_1 = __importDefault(require("zlib"));
class HttpUtil {
    static convertHttpHeaderToBuffer(header) {
        let lines = [];
        if (header.type == HttpPipe_1.MessageType.Request) {
            lines.push(`${HttpPipe_1.HttpMethod[header.method]} ${header.path} ${header.version}`);
        }
        else {
            lines.push(`${header.version} ${header.status} ${header.statusText}`);
        }
        for (let i = 0; i < header.headers.length; i++) {
            let nameValue = header.headers[i];
            lines.push(`${nameValue.name}: ${nameValue.value}`);
        }
        lines.push("\r\n");
        return Buffer.from(lines.join("\r\n"));
    }
    static findHeaderValue(httpHeader, name) {
        let nameValue = HttpUtil.findHeader(httpHeader, name);
        if (nameValue != null) {
            return nameValue.value;
        }
        return null;
    }
    static removeHeader(httpHeader, name) {
        for (let i = 0; i < httpHeader.headers.length; i++) {
            let nameValue = httpHeader.headers[i];
            if (nameValue.name.toLowerCase() == name.toLowerCase()) {
                httpHeader.headers.splice(i, 1);
                return;
            }
        }
    }
    static findHeader(httpHeader, name) {
        for (let i = 0; i < httpHeader.headers.length; i++) {
            let nameValue = httpHeader.headers[i];
            if (nameValue.name.toLowerCase() == name.toLowerCase()) {
                return nameValue;
            }
        }
        return null;
    }
    static findHeaders(httpHeader, name) {
        let result = [];
        for (let i = 0; i < httpHeader.headers.length; i++) {
            let nameValue = httpHeader.headers[i];
            if (nameValue.name.toLowerCase() == name.toLowerCase()) {
                result.push(nameValue);
            }
        }
        return result;
    }
    static isTextContentType(httpHeader) {
        let contentType = HttpUtil.findHeader(httpHeader, "Content-Type");
        if (contentType != null) {
            return contentType.value.indexOf("text/") > -1 || contentType.value.indexOf("application/json") > -1 || contentType.value.indexOf("application/javascript") > -1 || contentType.value.indexOf("application/xml") > -1;
        }
        return false;
    }
    static isChunked(httpHeader) {
        let transferEncoding = HttpUtil.findHeader(httpHeader, "Transfer-Encoding");
        if (transferEncoding != null) {
            return transferEncoding.value.toLowerCase() == "chunked";
        }
        return false;
    }
    static uncompressBody(contentEncoding, body) {
        if (contentEncoding != null) {
            contentEncoding = contentEncoding.toLowerCase();
            if (contentEncoding == "gzip") {
                return HttpUtil.gunzip(body);
            }
            else if (contentEncoding == "deflate") {
                return HttpUtil.inflate(body);
            }
        }
        return body;
    }
    static compressBody(contentEncoding, body) {
        if (contentEncoding != null) {
            if (contentEncoding == "gzip") {
                return HttpUtil.gzip(body);
            }
            else if (contentEncoding == "deflate") {
                return HttpUtil.deflate(body);
            }
        }
        return body;
    }
    static gzip(body) {
        return zlib_1.default.gzipSync(body);
    }
    static deflate(body) {
        return zlib_1.default.deflateSync(body);
    }
    static gunzip(body) {
        return zlib_1.default.gunzipSync(body);
    }
    static inflate(body) {
        return zlib_1.default.inflateSync(body);
    }
}
exports.default = HttpUtil;

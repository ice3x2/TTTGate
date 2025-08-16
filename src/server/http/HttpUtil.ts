import {HttpHeader, HttpMethod, HttpRequestHeader, HttpResponseHeader, MessageType, NameValue} from "./HttpPipe";
import zlib from "zlib";

/**
 * HTTP 유틸리티 클래스 - HTTP 관련 유틸리티 함수들을 제공합니다.
 */
class HttpUtil {
    // 압축 관련 상수
    private static readonly MAX_UNCOMPRESSED_SIZE = 100 * 1024 * 1024; // 100MB
    
    /**
     * HTTP 헤더를 버퍼로 변환
     */
    public static convertHttpHeaderToBuffer(header: HttpRequestHeader | HttpResponseHeader): Buffer {
        let lines: Array<string> = [];
        
        // 첫 번째 줄 생성
        if (header.type == MessageType.Request) {
            lines.push(`${HttpMethod[header.method]} ${header.path} ${header.version}`);
        } else {
            lines.push(`${header.version} ${header.status} ${header.statusText}`);
        }
        
        // 헤더 필드 추가
        for (let i = 0; i < header.headers.length; i++) {
            let nameValue = header.headers[i];
            lines.push(`${nameValue.name}: ${nameValue.value}`);
        }
        
        // 헤더 종료 표시 추가
        lines.push("\r\n");
        
        return Buffer.from(lines.join("\r\n"));
    }

    /**
     * HTTP 헤더에서 특정 이름의 헤더 값을 찾음
     */
    public static findHeaderValue(httpHeader: HttpHeader, name: string): string | null {
        let nameValue = HttpUtil.findHeader(httpHeader, name);
        if (nameValue != null) {
            return nameValue.value;
        }
        return null;
    }

    /**
     * HTTP 헤더에서 특정 이름의 헤더를 제거
     */
    public static removeHeader(httpHeader: HttpHeader, name: string): void {
        const normalizedName = name.toLowerCase();
        for (let i = 0; i < httpHeader.headers.length; i++) {
            let nameValue = httpHeader.headers[i];
            if (nameValue.name.toLowerCase() == normalizedName) {
                httpHeader.headers.splice(i, 1);
                i--; // 배열이 짧아지므로 인덱스 조정
            }
        }
    }

    /**
     * HTTP 헤더에서 특정 이름의 첫 번째 헤더를 찾음
     */
    public static findHeader(httpHeader: HttpHeader, name: string): NameValue | null {
        const normalizedName = name.toLowerCase();
        for (let i = 0; i < httpHeader.headers.length; i++) {
            let nameValue = httpHeader.headers[i];
            if (nameValue.name.toLowerCase() == normalizedName) {
                return nameValue;
            }
        }
        return null;
    }

    /**
     * HTTP 헤더에서 특정 이름의 모든 헤더를 찾음
     */
    public static findHeaders(httpHeader: HttpHeader, name: string): Array<NameValue> {
        let result: Array<NameValue> = [];
        const normalizedName = name.toLowerCase();
        
        for (let i = 0; i < httpHeader.headers.length; i++) {
            let nameValue = httpHeader.headers[i];
            if (nameValue.name.toLowerCase() == normalizedName) {
                result.push(nameValue);
            }
        }
        
        return result;
    }

    /**
     * HTTP 헤더가 텍스트 컨텐츠 타입인지 확인
     */
    public static isTextContentType(httpHeader: HttpHeader): boolean {
        let contentType = HttpUtil.findHeader(httpHeader, "Content-Type");
        
        if (contentType != null) {
            const value = contentType.value.toLowerCase();
            
            // 텍스트 컨텐츠 타입 확인
            return value.includes("text/") || 
                   value.includes("application/json") || 
                   value.includes("application/javascript") || 
                   value.includes("application/xml") || 
                   value.includes("application/xhtml+xml") ||
                   value.includes("application/atom+xml") ||
                   value.includes("application/rss+xml");
        }
        
        return false;
    }

    /**
     * HTTP 헤더가 chunked 인코딩을 사용하는지 확인
     */
    public static isChunked(httpHeader: HttpHeader): boolean {
        let transferEncoding = HttpUtil.findHeader(httpHeader, "Transfer-Encoding");
        
        if (transferEncoding != null) {
            return transferEncoding.value.toLowerCase().includes("chunked");
        }
        
        return false;
    }

    /**
     * HTTP 바디를 압축 해제
     */
    public static uncompressBody(contentEncoding: string | null, body: Buffer): Buffer {
        if (!contentEncoding || body.length === 0) {
            return body;
        }
        
        contentEncoding = contentEncoding.toLowerCase();
        try {
            if (contentEncoding.includes("gzip")) {
                return HttpUtil.gunzip(body);
            } else if (contentEncoding.includes("deflate")) {
                return HttpUtil.inflate(body);
            } else if (contentEncoding.includes("br")) {
                return HttpUtil.brotliDecompress(body);
            }
        } catch (err) {
            console.error(`Error decompressing ${contentEncoding} content:`, err);
        }
        
        return body;
    }

    /**
     * HTTP 바디를 압축
     */
    public static compressBody(contentEncoding: string | null, body: Buffer): Buffer {
        if (!contentEncoding || body.length === 0) {
            return body;
        }
        
        contentEncoding = contentEncoding.toLowerCase();
        try {
            if (contentEncoding.includes("gzip")) {
                return HttpUtil.gzip(body);
            } else if (contentEncoding.includes("deflate")) {
                return HttpUtil.deflate(body);
            } else if (contentEncoding.includes("br")) {
                return HttpUtil.brotliCompress(body);
            }
        } catch (err) {
            console.error(`Error compressing ${contentEncoding} content:`, err);
        }
        
        return body;
    }

    /**
     * gzip 압축
     */
    public static gzip(body: Buffer): Buffer {
        return zlib.gzipSync(body, { level: zlib.constants.Z_BEST_SPEED });
    }

    /**
     * deflate 압축
     */
    public static deflate(body: Buffer): Buffer {
        return zlib.deflateSync(body, { level: zlib.constants.Z_BEST_SPEED });
    }

    /**
     * Brotli 압축
     */
    public static brotliCompress(body: Buffer): Buffer {
        return zlib.brotliCompressSync(body, {
            params: {
                [zlib.constants.BROTLI_PARAM_QUALITY]: 3 // 낮은 품질로 빠르게 압축
            }
        });
    }

    /**
     * gzip 압축 해제
     */
    public static gunzip(body: Buffer): Buffer {
        try {
            return zlib.gunzipSync(body, {
                finishFlush: zlib.constants.Z_SYNC_FLUSH
            });
        } catch (err) {
            // 만약 gunzip에 실패하면 inflate로 시도 (일부 잘못된 구현이 있을 수 있음)
            try {
                return zlib.inflateSync(body);
            } catch (innerErr) {
                throw err; // 원래 에러 전달
            }
        }
    }

    /**
     * deflate 압축 해제
     */
    public static inflate(body: Buffer): Buffer {
        try {
            return zlib.inflateSync(body, {
                finishFlush: zlib.constants.Z_SYNC_FLUSH
            });
        } catch (err) {
            // 일부 구현은 zlib 헤더를 포함하지 않을 수 있으므로 raw inflate 시도
            try {
                return zlib.inflateRawSync(body);
            } catch (innerErr) {
                throw err; // 원래 에러 전달
            }
        }
    }

    /**
     * Brotli 압축 해제
     */
    public static brotliDecompress(body: Buffer): Buffer {
        return zlib.brotliDecompressSync(body);
    }

    /**
     * 연결이 keep-alive인지 확인합니다.
     */
    public static isKeepAlive(header: HttpHeader, version: string): boolean {
        // HTTP/1.1은 기본적으로 keep-alive
        let isKeepAlive = version.toUpperCase() === 'HTTP/1.1';
        
        const connection = HttpUtil.findHeaderValue(header, 'Connection');
        
        if (connection !== null) {
            const connectionValue = connection.toLowerCase();
            
            // connection 헤더 값에 따라 keep-alive 여부 결정
            if (connectionValue.includes('keep-alive')) {
                isKeepAlive = true;
            } else if (connectionValue.includes('close')) {
                isKeepAlive = false;
            }
        }
        
        return isKeepAlive;
    }

    /**
     * 지정된 헤더의 Keep-Alive 타임아웃 값을 가져옵니다.
     */
    public static getKeepAliveTimeout(header: HttpHeader): number | null {
        const keepAlive = HttpUtil.findHeaderValue(header, 'Keep-Alive');
        
        if (keepAlive) {
            // timeout=숫자 패턴 검색
            const match = keepAlive.match(/timeout=(\d+)/i);
            if (match && match[1]) {
                const timeout = parseInt(match[1]);
                if (!isNaN(timeout)) {
                    return timeout;
                }
            }
        }
        
        return null;
    }

    /**
     * 웹소켓 업그레이드 요청인지 확인합니다.
     */
    public static isWebSocketUpgrade(header: HttpHeader): boolean {
        const connection = HttpUtil.findHeaderValue(header, 'Connection');
        const upgrade = HttpUtil.findHeaderValue(header, 'Upgrade');
        
        return !!connection && !!upgrade && 
               connection.toLowerCase().includes('upgrade') && 
               upgrade.toLowerCase().includes('websocket');
    }

    /**
     * 지정된 길이의 Content-Length 헤더를 설정합니다.
     */
    public static setContentLength(header: HttpHeader, length: number): void {
        HttpUtil.removeHeader(header, 'Content-Length');
        header.headers.push({
            name: 'Content-Length',
            value: length.toString()
        });
        header.contentLength = length;
    }

    /**
     * Transfer-Encoding 헤더를 설정합니다.
     */
    public static setTransferEncoding(header: HttpHeader, encoding: string): void {
        HttpUtil.removeHeader(header, 'Transfer-Encoding');
        header.headers.push({
            name: 'Transfer-Encoding',
            value: encoding
        });
        
        if (encoding.toLowerCase().includes('chunked')) {
            header.chunked = true;
        } else {
            header.chunked = false;
        }
    }

    /**
     * Chunked 헤더를 추가합니다.
     */
    public static addChunkedEncoding(header: HttpHeader): void {
        // Content-Length 헤더가 있으면 제거
        HttpUtil.removeHeader(header, 'Content-Length');
        header.contentLength = -1;
        
        // Transfer-Encoding: chunked 설정
        HttpUtil.setTransferEncoding(header, 'chunked');
    }

    /**
     * 주어진 URL 문자열을 URL 객체로 파싱합니다.
     * 실패 시 null을 반환합니다.
     */
    public static parseUrl(urlString: string): URL | null {
        try {
            // 상대 URL인 경우 프로토콜과 호스트 부분을 추가
            if (!urlString.includes('://')) {
                urlString = 'http://localhost' + (urlString.startsWith('/') ? '' : '/') + urlString;
            }
            
            return new URL(urlString);
        } catch (err) {
            return null;
        }
    }

    /**
     * HTTP 요청에서 URL을 추출합니다.
     */
    public static getUrlFromRequest(header: HttpRequestHeader): URL | null {
        // 절대 URL인 경우
        if (header.path.includes('://')) {
            return HttpUtil.parseUrl(header.path);
        }
        
        // 상대 URL인 경우
        const host = HttpUtil.findHeaderValue(header, 'Host');
        if (host) {
            const protocol = header.version === 'HTTP/1.1' ? 'http://' : 'http://';
            return HttpUtil.parseUrl(protocol + host + header.path);
        }
        
        return null;
    }

    /**
     * URL 파라미터를 파싱합니다.
     */
    public static parseUrlParams(url: string): { [key: string]: string } {
        const params: { [key: string]: string } = {};
        const urlObj = HttpUtil.parseUrl(url);
        
        if (urlObj && urlObj.searchParams) {
            urlObj.searchParams.forEach((value, key) => {
                params[key] = value;
            });
        }
        
        return params;
    }

    /**
     * HTTP 메서드가 본문을 가질 수 있는지 확인합니다.
     */
    public static methodCanHaveBody(method: HttpMethod): boolean {
        return method === HttpMethod.POST || 
               method === HttpMethod.PUT || 
               method === HttpMethod.PATCH;
    }

    /**
     * Cookie 헤더에서 특정 쿠키 값을 추출합니다.
     */
    public static getCookieValue(header: HttpHeader, cookieName: string): string | null {
        const cookies = HttpUtil.findHeaderValue(header, 'Cookie');
        
        if (!cookies) {
            return null;
        }
        
        const cookiePattern = new RegExp(`\\b${cookieName}=([^;]*)`, 'i');
        const match = cookies.match(cookiePattern);
        
        return match ? match[1] : null;
    }


    /**
     * WebSocket URL을 HTTP URL로 변환합니다.
     * ws: -> http:, wss: -> https:
     */
    public static wsUrlToHttpUrl(url: string): string {
        if (url.startsWith('ws://')) {
            return 'http://' + url.substring(5);
        } else if (url.startsWith('wss://')) {
            return 'https://' + url.substring(6);
        }
        return url;
    }

    /**
     * HTTP URL을 WebSocket URL로 변환합니다.
     * http: -> ws:, https: -> wss:
     */
    public static httpUrlToWsUrl(url: string): string {
        if (url.startsWith('http://')) {
            return 'ws://' + url.substring(7);
        } else if (url.startsWith('https://')) {
            return 'wss://' + url.substring(8);
        }
        return url;
    }

    /**
     * URL이 WebSocket URL인지 확인합니다.
     */
    public static isWebSocketUrl(url: string): boolean {
        return url.startsWith('ws://') || url.startsWith('wss://');
    }

    /**
     * URL이 Secure WebSocket URL인지 확인합니다.
     */
    public static isSecureWebSocketUrl(url: string): boolean {
        return url.startsWith('wss://');
    }

}

export default HttpUtil;
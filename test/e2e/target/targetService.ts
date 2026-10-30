import http, {IncomingMessage, ServerResponse} from "http";
import {createHash} from "crypto";
import {URL} from "url";
import {Socket} from "net";
import {WebSocket, WebSocketServer} from "ws";

export type TargetCounters = {requests: number; wsConnections: number; wsMessages: number;
    /** 지금 열린 TCP 연결 수(#232). */
    openSockets: number;
    /** 아직 끝나지 않은 /drip 응답 수(#231·#232). */
    activeDrips: number;
    /** 지금 열린 WebSocket 수(#233·#235). */
    wsOpen: number;
};

export type TargetService = {
    port: number;
    wsPort: number;
    counters(): TargetCounters;
    close(): Promise<void>;
};

const PNG_1X1_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
const PNG_1X1 = Buffer.from(PNG_1X1_BASE64, "base64");
const CHUNK_SIZE = 64 * 1024;
const ASSET_JS_BODY = "window.__loaded=(window.__loaded||0)+1;";

export function bigPayloadChunk(offset: number, length: number): Buffer {
    const chunk = Buffer.alloc(length);
    for(let n = 0; n < length; n++) {
        const i = offset + n;
        chunk[n] = (i * 31 + (i >>> 16)) & 255;
    }
    return chunk;
}

export function bigPayloadDigest(mb: number): string {
    const hash = createHash("sha256");
    const total = mb * 1048576;
    for(let offset = 0; offset < total; offset += CHUNK_SIZE) {
        hash.update(bigPayloadChunk(offset, Math.min(CHUNK_SIZE, total - offset)));
    }
    return hash.digest("hex");
}

const buildIndexHtml = (host: string): string => {
    const scripts = Array.from({length: 40}, (_, i) => `<script src="/assets/a${i + 1}.js"></script>`).join("\n");
    const images = Array.from({length: 10}, (_, i) => `<img src="/assets/i${i + 1}.png">`).join("\n");
    return `<!doctype html>
<html><head><meta charset="utf-8"><title>Target OK</title></head>
<body>
<span id="host">${host}</span>
${scripts}
${images}
<div id="ready"></div>
<script>window.addEventListener('load', function(){ document.getElementById('ready').textContent = 'ready'; });</script>
</body></html>`;
};

const buildAbsoluteHtml = (host: string): string => `<!doctype html>
<html><body>
<a id="link" href="http://${host}/absolute-target">go</a>
<p id="text">http://${host}</p>
</body></html>`;

const buildWsPageHtml = (): string => `<!doctype html>
<html><body>
<div id="ws-result"></div>
<script>
(function(){
    var ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws');
    var ticks = 0, echoed = false;
    function done(text) { document.getElementById('ws-result').textContent = text; }
    ws.addEventListener('open', function(){ ws.send('hello'); });
    ws.addEventListener('message', function(ev){
        var data = ev.data;
        if(typeof data === 'string' && data.indexOf('tick:') === 0) ticks++;
        else if(data === 'echo:hello') echoed = true;
        if(ticks >= 5 && echoed) done('ok');
    });
    ws.addEventListener('error', function(){ done('fail:error'); });
    ws.addEventListener('close', function(){
        if(ticks < 5 || !echoed) done('fail:close');
    });
})();
</script>
</body></html>`;

const readBody = (req: IncomingMessage): Promise<Buffer> => new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
});

const writeStreamed = (res: ServerResponse, total: number): void => {
    let offset = 0;
    const writeNext = () => {
        if(offset >= total) {
            res.end();
            return;
        }
        const length = Math.min(CHUNK_SIZE, total - offset);
        const chunk = bigPayloadChunk(offset, length);
        offset += length;
        if(res.write(chunk)) {
            setImmediate(writeNext);
        } else {
            res.once("drain", writeNext);
        }
    };
    writeNext();
};

export function startTargetService(options: {slowDelayMs?: number} = {}): Promise<TargetService> {
    const slowDelayMs = options.slowDelayMs ?? 1000;
    let requests = 0;
    let wsConnections = 0;
    let wsMessages = 0;
    let activeDrips = 0;
    const sockets = new Set<Socket>();

    const wss = new WebSocketServer({noServer: true});
    wss.on("connection", (ws: WebSocket) => {
        wsConnections++;
        let tickIndex = 0;
        const interval = setInterval(() => {
            tickIndex++;
            if(tickIndex > 5) {
                clearInterval(interval);
                return;
            }
            ws.send(`tick:${tickIndex}`);
        }, 1000);
        ws.on("message", (data) => {
            wsMessages++;
            const text = Buffer.isBuffer(data) ? data.toString("utf-8") : String(data);
            ws.send(`echo:${text}`);
        });
        ws.on("close", () => clearInterval(interval));
    });

    // #233: 받은 프레임을 그대로(텍스트·바이너리 구분 유지) 되돌려 주는 WebSocket. 텍스트 명령도 받는다.
    //   push:<n>              → push:1 … push:n 을 먼저 보낸다
    //   close:<code>:<reason> → 그 코드와 이유로 닫는다
    const rawWss = new WebSocketServer({noServer: true, maxPayload: 64 * 1024 * 1024});
    rawWss.on("connection", (ws: WebSocket) => {
        wsConnections++;
        ws.on("message", (data, isBinary) => {
            wsMessages++;
            if(!isBinary) {
                const text = data.toString();
                const push = /^push:(\d+)$/.exec(text);
                if(push) {
                    for(let n = 1; n <= Number(push[1]); n++) ws.send(`push:${n}`);
                    return;
                }
                const close = /^close:(\d+):(.*)$/.exec(text);
                if(close) {
                    ws.close(Number(close[1]), close[2]);
                    return;
                }
            }
            ws.send(data, {binary: isBinary});
        });
    });

    const server = http.createServer(async (req, res) => {
        requests++;
        res.setHeader("Cache-Control", "no-store");
        const host = (req.headers.host as string) ?? "";
        const method = req.method ?? "GET";
        const parsedUrl = new URL(req.url ?? "/", `http://${host || "127.0.0.1"}`);
        const pathname = parsedUrl.pathname;

        const assetJsMatch = pathname.match(/^\/assets\/a(\d+)\.js$/);
        const assetPngMatch = pathname.match(/^\/assets\/i(\d+)\.png$/);

        if(pathname === "/") {
            res.writeHead(200, {"Content-Type": "text/html; charset=utf-8"});
            res.end(buildIndexHtml(host));
        } else if(assetJsMatch && Number(assetJsMatch[1]) >= 1 && Number(assetJsMatch[1]) <= 40) {
            res.writeHead(200, {"Content-Type": "application/javascript", "Cache-Control": "no-store"});
            res.end(ASSET_JS_BODY);
        } else if(assetPngMatch && Number(assetPngMatch[1]) >= 1 && Number(assetPngMatch[1]) <= 10) {
            res.writeHead(200, {"Content-Type": "image/png", "Cache-Control": "no-store"});
            res.end(PNG_1X1);
        } else if(pathname === "/absolute") {
            res.writeHead(200, {"Content-Type": "text/html; charset=utf-8"});
            res.end(buildAbsoluteHtml(host));
        } else if(pathname === "/api/cors") {
            res.writeHead(200, {"Content-Type": "application/json", "Access-Control-Allow-Origin": "http://target.invalid"});
            res.end(JSON.stringify({ok: true}));
        } else if(pathname === "/headers") {
            res.writeHead(200, {"Content-Type": "application/json"});
            res.end(JSON.stringify(req.headers));
        } else if(pathname === "/custom-response") {
            res.writeHead(200, {"Content-Type": "text/plain", "X-Target": "original"});
            res.end("original-body");
        } else if(pathname === "/big") {
            const mbRaw = parsedUrl.searchParams.get("mb") ?? "";
            const isValidMb = /^[1-9]\d*$/.test(mbRaw) && Number(mbRaw) <= 1024;
            if(!isValidMb) {
                res.writeHead(400, {"Content-Type": "text/plain"});
                res.end("invalid mb");
            } else {
                const mb = Number(mbRaw);
                const total = mb * 1048576;
                res.writeHead(200, {"Content-Type": "application/octet-stream", "Content-Length": String(total)});
                writeStreamed(res, total);
            }
        } else if(pathname === "/slow") {
            const msRaw = parsedUrl.searchParams.get("ms");
            const ms = msRaw !== null && Number.isFinite(Number(msRaw)) ? Number(msRaw) : slowDelayMs;
            setTimeout(() => {
                res.writeHead(200, {"Content-Type": "text/plain"});
                res.end("slow-done");
            }, ms);
        } else if(pathname === "/echo-post") {
            if(method !== "POST") {
                res.writeHead(405, {"Content-Type": "text/plain"});
                res.end("method not allowed");
            } else {
                const body = await readBody(req);
                res.writeHead(200, {"Content-Type": req.headers["content-type"] ?? "application/octet-stream"});
                res.end(body);
            }
        } else if(pathname === "/big-cut") {
            // #237: mb 만큼 보낸다고 알리고, cutAfterMb 만큼만 보낸 뒤 대상 쪽에서 연결을 끊는다.
            const mb = Math.min(1024, Math.max(1, Number(parsedUrl.searchParams.get("mb") ?? "64")));
            const cutAt = Math.min(mb, Math.max(1, Number(parsedUrl.searchParams.get("cutAfterMb") ?? "8"))) * 1048576;
            res.writeHead(200, {"Content-Type": "application/octet-stream", "Content-Length": String(mb * 1048576)});
            let offset = 0;
            const writeNext = () => {
                while(offset < cutAt) {
                    const length = Math.min(CHUNK_SIZE, cutAt - offset);
                    const ok = res.write(bigPayloadChunk(offset, length));
                    offset += length;
                    if(!ok) { res.once("drain", writeNext); return; }
                }
                res.socket?.destroy();
            };
            writeNext();
        } else if(pathname === "/drip") {
            // #231·#232: 끊길 때까지 조금씩 계속 보낸다. 전송 도중의 장애를 재현할 때 쓴다.
            const intervalMs = Math.max(5, Number(parsedUrl.searchParams.get("ms") ?? "50"));
            const size = Math.min(1048576, Math.max(1, Number(parsedUrl.searchParams.get("size") ?? "16384")));
            activeDrips++;
            res.writeHead(200, {"Content-Type": "application/octet-stream"});
            const chunk = Buffer.alloc(size, 0x61);
            const timer = setInterval(() => { if(!res.destroyed) res.write(chunk); }, intervalMs);
            let ended = false;
            const finish = () => { if(ended) return; ended = true; clearInterval(timer); activeDrips--; };
            res.on("close", finish);
            req.socket.on("close", finish);
        } else if(pathname === "/ws-page") {
            res.writeHead(200, {"Content-Type": "text/html; charset=utf-8"});
            res.end(buildWsPageHtml());
        } else {
            res.writeHead(404, {"Content-Type": "text/plain"});
            res.end("not found");
        }
    });

    server.on("upgrade", (req: IncomingMessage, socket: Socket, head: Buffer) => {
        const pathname = new URL(req.url ?? "/", "http://127.0.0.1").pathname;
        if(pathname === "/ws-raw") {
            rawWss.handleUpgrade(req, socket, head, (ws) => rawWss.emit("connection", ws, req));
            return;
        }
        if(pathname !== "/ws") {
            socket.destroy();
            return;
        }
        wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
    });

    server.on("connection", (socket: Socket) => {
        sockets.add(socket);
        socket.on("close", () => sockets.delete(socket));
    });

    return new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", () => {
            const address = server.address();
            const port = typeof address === "object" && address ? address.port : 0;
            let closed = false;
            resolve({
                port,
                wsPort: port,
                counters(): TargetCounters {
                    return {requests, wsConnections, wsMessages, openSockets: sockets.size, activeDrips,
                        wsOpen: wss.clients.size + rawWss.clients.size};
                },
                async close(): Promise<void> {
                    if(closed) return;
                    closed = true;
                    for(const client of wss.clients) client.terminate();
                    for(const client of rawWss.clients) client.terminate();
                    await new Promise<void>((closeResolve) => wss.close(() => closeResolve()));
                    await new Promise<void>((closeResolve) => rawWss.close(() => closeResolve()));
                    server.closeAllConnections?.();
                    await new Promise<void>((closeResolve, closeReject) => {
                        server.close((err) => (err ? closeReject(err) : closeResolve()));
                    });
                }
            });
        });
    });
}

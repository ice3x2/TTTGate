import http from "http";
import net from "net";
import {createHash} from "crypto";
import {WebSocket} from "ws";

import {startTargetService, TargetService, bigPayloadChunk, bigPayloadDigest} from "./targetService";

/** 타이머(단조 시계)와 측정 시계의 밀리초 반올림 차이(#243). */
const SLOW_TOLERANCE_MS = 2;

jest.setTimeout(30_000);

type RawResponse = {statusCode: number; headers: http.IncomingHttpHeaders; body: Buffer};

const rawRequest = (options: {port: number; path: string; method?: string; headers?: Record<string, string>; body?: Buffer | string}): Promise<RawResponse> => {
    return new Promise((resolve, reject) => {
        const req = http.request({
            host: "127.0.0.1",
            port: options.port,
            path: options.path,
            method: options.method ?? "GET",
            headers: options.headers
        }, (res) => {
            const chunks: Buffer[] = [];
            res.on("data", (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
            res.on("end", () => resolve({statusCode: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks)}));
        });
        req.on("error", reject);
        if(options.body !== undefined) req.write(options.body);
        req.end();
    });
};

describe("targetService", () => {
    let target: TargetService;

    beforeAll(async () => {
        target = await startTargetService();
    });

    afterAll(async () => {
        await target.close();
    });

    test("GET / serves the index page with 40 scripts, 10 images and a ready marker", async () => {
        const res = await rawRequest({port: target.port, path: "/"});
        expect(res.statusCode).toBe(200);
        expect(res.headers["content-type"]).toMatch(/^text\/html/);
        const body = res.body.toString("utf-8");
        expect(body).toContain("<title>Target OK</title>");
        expect(body).toContain(`<span id="host">127.0.0.1:${target.port}</span>`);
        for(let n = 1; n <= 40; n++) expect(body).toContain(`/assets/a${n}.js`);
        for(let n = 1; n <= 10; n++) expect(body).toContain(`/assets/i${n}.png`);
        expect(body).toContain('id="ready"');
    });

    test("GET /assets/a7.js serves a no-store javascript asset", async () => {
        const res = await rawRequest({port: target.port, path: "/assets/a7.js"});
        expect(res.statusCode).toBe(200);
        expect(res.headers["content-type"]).toBe("application/javascript");
        expect(res.headers["cache-control"]).toBe("no-store");
        expect(res.body.toString("utf-8")).toBe("window.__loaded=(window.__loaded||0)+1;");
    });

    test("GET /assets/i3.png serves a png with a valid signature", async () => {
        const res = await rawRequest({port: target.port, path: "/assets/i3.png"});
        expect(res.statusCode).toBe(200);
        expect(res.headers["content-type"]).toBe("image/png");
        expect(res.body.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    });

    test("GET /assets/a41.js is not found", async () => {
        const res = await rawRequest({port: target.port, path: "/assets/a41.js"});
        expect(res.statusCode).toBe(404);
    });

    test("GET /absolute exposes the request host for host-rewrite assertions", async () => {
        const res = await rawRequest({port: target.port, path: "/absolute"});
        const body = res.body.toString("utf-8");
        expect(body).toContain(`href="http://127.0.0.1:${target.port}/absolute-target"`);
        expect(body).toContain(`<p id="text">http://127.0.0.1:${target.port}</p>`);
    });

    test("GET /api/cors returns json with a foreign ACAO header", async () => {
        const res = await rawRequest({port: target.port, path: "/api/cors"});
        expect(res.headers["content-type"]).toBe("application/json");
        expect(JSON.parse(res.body.toString("utf-8"))).toEqual({ok: true});
        expect(res.headers["access-control-allow-origin"]).toBe("http://target.invalid");
    });

    test("GET /headers echoes request headers including a custom one", async () => {
        const res = await rawRequest({port: target.port, path: "/headers", headers: {"X-Probe": "1"}});
        const json = JSON.parse(res.body.toString("utf-8"));
        expect(json["x-probe"]).toBe("1");
        expect(json["host"]).toBe(`127.0.0.1:${target.port}`);
    });

    test("GET /custom-response returns a custom header and body", async () => {
        const res = await rawRequest({port: target.port, path: "/custom-response"});
        expect(res.headers["x-target"]).toBe("original");
        expect(res.body.toString("utf-8")).toBe("original-body");
    });

    test("GET /big?mb=2 streams the exact byte count and digest", async () => {
        const res = await rawRequest({port: target.port, path: "/big?mb=2"});
        expect(res.statusCode).toBe(200);
        expect(res.headers["content-length"]).toBe(String(2 * 1048576));
        expect(res.body.length).toBe(2 * 1048576);
        const digest = createHash("sha256").update(res.body).digest("hex");
        expect(digest).toBe(bigPayloadDigest(2));
    });

    test.each(["0", "abc", "1025"])("GET /big?mb=%s is rejected with 400", async (mb) => {
        const res = await rawRequest({port: target.port, path: `/big?mb=${mb}`});
        expect(res.statusCode).toBe(400);
    });

    test("GET /slow?ms=300 waits at least 300ms before responding", async () => {
        // #243: 단조 시계로 재고, 밀리초 반올림 오차만큼(2ms) 허용한다.
        const start = performance.now();
        const res = await rawRequest({port: target.port, path: "/slow?ms=300"});
        expect(performance.now() - start).toBeGreaterThanOrEqual(300 - SLOW_TOLERANCE_MS);
        expect(res.body.toString("utf-8")).toBe("slow-done");
    });

    test("GET /slow honors the configured default delay", async () => {
        const other = await startTargetService({slowDelayMs: 150});
        try {
            const start = performance.now();
            await rawRequest({port: other.port, path: "/slow"});
            expect(performance.now() - start).toBeGreaterThanOrEqual(150 - SLOW_TOLERANCE_MS);
        } finally {
            await other.close();
        }
    });

    test("POST /echo-post mirrors content-type and body; GET is rejected", async () => {
        const res = await rawRequest({
            port: target.port, path: "/echo-post", method: "POST",
            headers: {"Content-Type": "text/plain", "Content-Length": "7"}, body: "abc-123"
        });
        expect(res.body.toString("utf-8")).toBe("abc-123");
        expect(res.headers["content-type"]).toBe("text/plain");

        const getRes = await rawRequest({port: target.port, path: "/echo-post"});
        expect(getRes.statusCode).toBe(405);
    });

    test("GET /nope is not found", async () => {
        const res = await rawRequest({port: target.port, path: "/nope"});
        expect(res.statusCode).toBe(404);
        expect(res.body.toString("utf-8")).toBe("not found");
    });

    test("no-store is applied consistently across ok, custom, big and 404 responses", async () => {
        for(const path of ["/", "/custom-response", "/big?mb=1", "/nope"]) {
            const res = await rawRequest({port: target.port, path});
            expect(res.headers["cache-control"]).toBe("no-store");
        }
    });

    test("WebSocket echoes and streams five ticks, then the counters reflect the exchange", async () => {
        const before = target.counters();
        const ws = new WebSocket(`ws://127.0.0.1:${target.port}/ws`);
        const received: string[] = [];
        await new Promise<void>((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error("timed out waiting for tick:5")), 7000);
            ws.on("open", () => ws.send("hello"));
            ws.on("message", (data) => {
                received.push(data.toString("utf-8"));
                if(received.includes("tick:5")) {
                    clearTimeout(timer);
                    resolve();
                }
            });
            ws.on("error", (err) => { clearTimeout(timer); reject(err); });
        });
        expect(received).toContain("echo:hello");
        for(let n = 1; n <= 5; n++) expect(received).toContain(`tick:${n}`);
        expect(received.indexOf("tick:1")).toBeLessThan(received.indexOf("tick:2"));
        expect(received.indexOf("tick:4")).toBeLessThan(received.indexOf("tick:5"));
        ws.close();
        await new Promise((resolve) => ws.once("close", resolve));

        const after = target.counters();
        expect(after.wsConnections - before.wsConnections).toBe(1);
        expect(after.wsMessages - before.wsMessages).toBe(1);
    });

    test("counters().requests tracks http requests issued within this test, not upgrades", async () => {
        const before = target.counters().requests;
        await rawRequest({port: target.port, path: "/nope"});
        await rawRequest({port: target.port, path: "/nope"});
        await rawRequest({port: target.port, path: "/nope"});
        expect(target.counters().requests - before).toBe(3);
    });

    test("upgrading a non-/ws path closes the socket", async () => {
        const outcome = await new Promise<"error" | "close">((resolve) => {
            const ws = new WebSocket(`ws://127.0.0.1:${target.port}/nope-ws`);
            ws.on("error", () => resolve("error"));
            ws.on("close", () => resolve("close"));
        });
        expect(["error", "close"]).toContain(outcome);
    });

    test("bigPayloadChunk and bigPayloadDigest compute the expected deterministic bytes", () => {
        expect(Array.from(bigPayloadChunk(0, 4))).toEqual([0, 31, 62, 93]);
        expect(bigPayloadChunk(65536, 1)[0]).toBe((65536 * 31 + 1) & 255);
        const wholeDigest = createHash("sha256").update(bigPayloadChunk(0, 1048576)).digest("hex");
        expect(bigPayloadDigest(1)).toBe(wholeDigest);
    });
});

describe("targetService close()", () => {
    test("close() refuses further connections and is idempotent", async () => {
        const service = await startTargetService();
        const port = service.port;
        await service.close();
        await expect(new Promise((resolve, reject) => {
            const socket = net.connect({host: "127.0.0.1", port});
            socket.once("error", reject);
            socket.once("connect", resolve);
        })).rejects.toMatchObject({code: "ECONNREFUSED"});
        await service.close();
    });
});

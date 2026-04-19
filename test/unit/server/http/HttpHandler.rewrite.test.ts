import zlib from "zlib";
import HttpHandler from "../../../../src/server/http/HttpHandler";
import HttpUtil from "../../../../src/server/http/HttpUtil";
import {ResourcePolicyRegistry} from "../../../../src/util/ResourcePolicy";
import {TunnelingOption} from "../../../../src/types/TunnelingOption";

type MockSocketHandler = {
    id: number;
    socket: {remoteAddress: string, remotePort: number};
    breakBufferFlush: boolean;
    writes: Buffer[];
    onSocketEvent?: (handler: any, state: any, data?: any) => void;
    setBundle(key: string, value: any): void;
    getBundle(key: string): any;
    deleteBundle(key: string): void;
    isEnd(): boolean;
    isSecure(): boolean;
    sendData(data: Buffer, callback?: (client: any, success: boolean) => void): void;
    destroy(): void;
    end_(): void;
    setTimeout(): void;
    isOutputDrained: boolean;
};

const createMockSocketHandler = (): MockSocketHandler => {
    const bundles = new Map<string, any>();

    return {
        id: 1,
        socket: {
            remoteAddress: "127.0.0.1",
            remotePort: 12345
        },
        breakBufferFlush: false,
        writes: [],
        setBundle(key: string, value: any) {
            bundles.set(key, value);
        },
        getBundle(key: string): any {
            return bundles.get(key);
        },
        deleteBundle(key: string): void {
            bundles.delete(key);
        },
        isEnd(): boolean {
            return false;
        },
        isSecure(): boolean {
            return false;
        },
        sendData(data: Buffer, callback?: (client: any, success: boolean) => void): void {
            this.writes.push(Buffer.from(data));
            callback?.(this, true);
        },
        destroy: jest.fn(),
        end_: jest.fn(),
        setTimeout: jest.fn(),
        isOutputDrained: true
    };
};

const parseChunkedBody = (response: Buffer): {header: string, body: Buffer} => {
    const separatorIndex = response.indexOf("\r\n\r\n");
    const header = response.subarray(0, separatorIndex).toString("utf-8");
    const payload = response.subarray(separatorIndex + 4);
    const chunks: Buffer[] = [];
    let offset = 0;

    while(offset < payload.length) {
        const sizeEnd = payload.indexOf("\r\n", offset);
        const size = parseInt(payload.subarray(offset, sizeEnd).toString("utf-8"), 16);
        offset = sizeEnd + 2;
        if(size === 0) {
            break;
        }
        chunks.push(payload.subarray(offset, offset + size));
        offset += size + 2;
    }

    return {
        header,
        body: Buffer.concat(chunks)
    };
};

describe("HttpHandler rewrite guardrails", () => {
    afterEach(() => {
        ResourcePolicyRegistry.reset();
        jest.restoreAllMocks();
    });

    it("bypasses body rewriting when the decompressed payload exceeds the configured limit", () => {
        ResourcePolicyRegistry.configure({
            httpRewriteDecompressLimitBytes: 1024
        });
        jest.spyOn(HttpUtil, "uncompressBody").mockImplementation(() => {
            const error = new Error("HTTP body rewrite decompress limit exceeded");
            (error as Error & {code?: string}).code = HttpUtil.DECOMPRESS_LIMIT_ERROR_CODE;
            throw error;
        });

        const socketHandler = createMockSocketHandler();
        const option: TunnelingOption = {
            forwardPort: 8080,
            protocol: "http",
            destinationAddress: "internal.example",
            destinationPort: 80,
            keepAlive: 0,
            httpOption: {
                rewriteHostInTextBody: true
            }
        };
        const handler = HttpHandler.create(socketHandler as any, option);
        (handler as any)._originHost = "public.example";

        const originalText = "http://internal.example/" + "a".repeat(128);
        const compressedBody = zlib.gzipSync(Buffer.from(originalText, "utf-8"), {
            level: zlib.constants.Z_BEST_SPEED
        });
        const response = Buffer.concat([
            Buffer.from(
                `HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nContent-Encoding: gzip\r\nContent-Length: ${compressedBody.length}\r\n\r\n`,
                "utf-8"
            ),
            compressedBody
        ]);

        handler.sendData(response);

        const {header, body} = parseChunkedBody(Buffer.concat(socketHandler.writes));
        const inflatedBody = zlib.gunzipSync(body).toString("utf-8");

        expect(header.toLowerCase()).toContain("transfer-encoding: chunked");
        expect(inflatedBody).toContain("internal.example");
        expect(inflatedBody).not.toContain("public.example");
        expect(socketHandler.destroy).not.toHaveBeenCalled();
    });
});

import net from "net";
import {TCPServer, ServerOption} from "../../../src/util/TCPServer";
import SocketState from "../../../src/util/SocketState";
import {getFreePort} from "../../helpers/network";

jest.setTimeout(30_000);

const startServer = async (admit?: ServerOption["admit"]): Promise<{server: TCPServer; port: number}> => {
    const port = await getFreePort();
    const server = TCPServer.create({port, admit});
    await new Promise<void>((resolve, reject) => {
        server.start((err) => err ? reject(err) : resolve());
    });
    return {server, port};
};

const connectAndCollectUntilClose = (port: number, timeoutMs: number = 1000): Promise<Buffer> => new Promise((resolve, reject) => {
    const socket = net.connect({host: "127.0.0.1", port});
    const chunks: Buffer[] = [];
    const timer = setTimeout(() => reject(new Error(`socket did not close within ${timeoutMs}ms`)), timeoutMs);
    socket.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    socket.once("close", () => { clearTimeout(timer); resolve(Buffer.concat(chunks)); });
    socket.once("error", () => { /* a destroyed socket also raises ECONNRESET; close still fires */ });
});

describe("TCPServer admission gate", () => {
    const servers: TCPServer[] = [];

    afterEach(async () => {
        await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.stop(() => resolve()))));
    });

    it("destroys the socket before Bound when admit rejects without a reject response", async () => {
        const {server, port} = await startServer(() => ({allowed: false, reason: "rate-limit-ban"}));
        servers.push(server);
        let bound = false;
        server.setOnServerEvent((_server, state) => { if(state === SocketState.Bound) bound = true; });

        const received = await connectAndCollectUntilClose(port);

        expect(received.length).toBe(0);
        expect(bound).toBe(false);
        expect(server.handlerCount).toBe(0);
    });

    it("writes the reject response then closes when admit rejects with a concurrency-limit response", async () => {
        const {server, port} = await startServer(() => ({allowed: false, reason: "concurrency-limit", rejectResponse: Buffer.from("X")}));
        servers.push(server);

        const received = await connectAndCollectUntilClose(port);

        expect(received.toString()).toBe("X");
        expect(server.handlerCount).toBe(0);
    });

    it("binds normally when admit allows", async () => {
        const {server, port} = await startServer(() => ({allowed: true}));
        servers.push(server);

        const bound = await new Promise<boolean>((resolve) => {
            server.setOnServerEvent((_server, state) => { if(state === SocketState.Bound) resolve(true); });
            net.connect({host: "127.0.0.1", port});
        });

        expect(bound).toBe(true);
        expect(server.handlerCount).toBe(1);
    });

    it("binds normally when admit is not configured (existing behavior)", async () => {
        const {server, port} = await startServer(undefined);
        servers.push(server);

        const bound = await new Promise<boolean>((resolve) => {
            server.setOnServerEvent((_server, state) => { if(state === SocketState.Bound) resolve(true); });
            net.connect({host: "127.0.0.1", port});
        });

        expect(bound).toBe(true);
    });

    it("passes the normalized remote address to admit", async () => {
        const seen: Array<string | undefined> = [];
        const {server, port} = await startServer((addr) => { seen.push(addr); return {allowed: true}; });
        servers.push(server);

        await new Promise<void>((resolve) => {
            server.setOnServerEvent((_server, state) => { if(state === SocketState.Bound) resolve(); });
            net.connect({host: "127.0.0.1", port});
        });

        expect(seen.length).toBe(1);
        expect(["127.0.0.1", "::ffff:127.0.0.1"]).toContain(seen[0]);
    });
});

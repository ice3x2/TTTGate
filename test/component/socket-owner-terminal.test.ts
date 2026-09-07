import net from "node:net";
import {once} from "node:events";
import {setTimeout as delay} from "node:timers/promises";
import {SocketHandler} from "../../src/util/SocketHandler";
import SocketState from "../../src/util/SocketState";

const withOwner = async (check: (context: any) => Promise<void>, reentrant = false) => {
    const server = net.createServer();
    let client: net.Socket | undefined;
    let handler: SocketHandler | undefined;
    const live = new Map<number, SocketHandler>();
    const calls: Array<{handler: SocketHandler; state: SocketState}> = [];
    const appStates: Array<{state: SocketState; owned: boolean}> = [];
    try {
        server.listen(0, "127.0.0.1");
        await once(server, "listening");
        const port = (server.address() as net.AddressInfo).port;
        const bound = new Promise<SocketHandler>((resolve) => server.once("connection", (socket) => {
            // Reflect.apply exercises the future optional argument on the old
            // implementation too; no factory/socket behavior is substituted.
            const owned = Reflect.apply(SocketHandler.bound, SocketHandler, [
                {socket, port, addr: "127.0.0.1", tls: false, keepAlive: 0}, () => {},
                (terminated: SocketHandler) => {
                    calls.push({handler: terminated, state: terminated.state});
                    live.delete(terminated.id);
                    if(reentrant) terminated.destroy();
                },
            ]) as SocketHandler;
            live.set(owned.id, owned);
            resolve(owned);
        }));
        client = net.createConnection({host: "127.0.0.1", port, allowHalfOpen: true});
        client.on("error", () => {});
        client.resume();
        await once(client, "connect");
        handler = await bound;
        handler.onSocketEvent = (current, state) => {
            if(state === SocketState.End || state === SocketState.Closed) {
                appStates.push({state, owned: live.has(current.id)});
            }
        };
        expect(calls).toHaveLength(0);
        expect(live.get(handler.id)).toBe(handler);
        const settle = async () => {
            const deadline = Date.now() + 2000;
            while(handler!.state !== SocketState.Closed) {
                if(Date.now() > deadline) throw new Error("Handler did not close");
                await delay(5);
            }
        };
        await check({handler, client, calls, live, appStates, settle});
    } finally {
        handler?.destroy();
        client?.destroy();
        if(server.listening) await new Promise<void>((resolve) => server.close(() => resolve()));
    }
};

test.each(["end", "close", "error", "destroy", "endImmediate"])(
    "owner terminal notification is once-only and precedes replaceable callbacks (%s)", async (mode) => {
        await withOwner(async ({handler, client, calls, live, appStates, settle}) => {
            if(mode === "end") client.end();
            else if(mode === "close") handler.socket.destroy();
            else if(mode === "error") handler.socket.destroy(new Error("intentional owner-hook error"));
            else if(mode === "destroy") handler.destroy();
            else {
                handler.endImmediate();
                client.end();
            }
            await settle();
            expect(calls).toHaveLength(1);
            expect(calls[0].handler).toBe(handler);
            expect([SocketState.End, SocketState.Closed]).toContain(calls[0].state);
            expect(live.size).toBe(0);
            expect(appStates.length).toBeGreaterThan(0);
            expect(appStates.every((event: {owned: boolean}) => !event.owned)).toBe(true);
            handler.destroy();
            handler.endImmediate();
            expect(calls).toHaveLength(1);
        });
    });

test("owner callback may reenter destroy without being called twice", async () => {
    await withOwner(async ({client, calls, live, settle}) => {
        client.end();
        await settle();
        expect(calls).toHaveLength(1);
        expect(calls[0].state).toBe(SocketState.End);
        expect(live.size).toBe(0);
    }, true);
});

test("end_ preserves ownership during pending write/drain and peer FIN", async () => {
    await withOwner(async ({handler, client, calls, live, settle}) => {
        const payload = Buffer.from("pending owner drain");
        const chunks: Buffer[] = [];
        client.on("data", (chunk: Buffer) => chunks.push(chunk));
        const peerEnd = once(client, "end");
        handler.sendData(payload);
        expect(handler.isOutputDrained).toBe(false);
        handler.end_();
        expect(calls).toHaveLength(0);
        expect(live.has(handler.id)).toBe(true);
        await peerEnd;
        expect(Buffer.concat(chunks)).toEqual(payload);
        expect(calls).toHaveLength(0);
        expect(live.has(handler.id)).toBe(true);
        client.end();
        await settle();
        expect(calls).toHaveLength(1);
        expect(live.size).toBe(0);
    });
});

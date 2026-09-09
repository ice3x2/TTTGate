import http from "node:http";
import {setTimeout as delay} from "node:timers/promises";
import {ExternalPortServerPool} from "../../src/server/ExternalPortServerPool";
import SocketState from "../../src/util/SocketState";
import {getFreePort} from "../helpers/network";

// Exercise the actual pool consumer, injecting only ordered raw-data and
// CloseSession inputs at its existing public boundary, not a mock sendData.
test.each([false, true])("rewrite EOF reaches the actual consumer when CloseSession precedes last data=%s", async closeFirst => {
    const port = await getFreePort();
    const pool = ExternalPortServerPool.create([]);
    let session: number | undefined;
    let requestSeen = false;
    pool.OnNewSessionCallback = id => { session = id; };
    pool.OnHandlerEventCallback = (_id, state) => { if(state === SocketState.Receive) requestSeen = true; };
    let request: http.ClientRequest | undefined;
    let completed: Promise<{body: string, complete: boolean}> | undefined;
    const until = async (condition: () => boolean) => {
        const deadline = Date.now() + 2000;
        while(!condition()) { if(Date.now() > deadline) throw new Error("EOF consumer condition timed out"); await delay(5); }
    };
    try {
        await pool.startServer({forwardPort: port, protocol: "http", destinationAddress: "internal.example", destinationPort: 80,
            tls: false, keepAlive: 0, httpOption: {rewriteHostInTextBody: true}});
        request = http.request({host: "127.0.0.1", port, path: "/", headers: {Host: "public.example"}, agent: false});
        completed = new Promise((resolve, reject) => {
            request!.once("error", reject);
            request!.once("response", response => {
                const chunks: Buffer[] = [];
                response.on("data", data => chunks.push(Buffer.from(data)));
                response.once("error", reject);
                response.once("end", () => resolve({body: Buffer.concat(chunks).toString(), complete: response.complete}));
            });
            request!.setTimeout(2000, () => request!.destroy(new Error("actual HTTP consumer did not finish at declared EOF")));
        });
        completed.catch(() => {});
        request.end(); await until(() => session !== undefined && requestSeen);
        const header = Buffer.from("HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nConnection: close\r\n\r\n");
        const body = Buffer.from("http://internal.example/complete");
        expect(pool.send(session!, header)).toBe(true);
        await until(() => (pool as any)._handlerMap.get(session!).sendLength === header.length);
        if(closeFirst) pool.closeSession(session!, header.length + body.length);
        expect(pool.send(session!, body)).toBe(true);
        if(!closeFirst) pool.closeSession(session!, header.length + body.length);
        expect(await completed).toEqual({body: "http://public.example/complete", complete: true});
        await until(() => pool.getServerStatus(port).sessions === 0);
    } finally {
        request?.destroy(); await pool.stopAll(); await completed?.catch(() => {});
    }
}, 10_000);

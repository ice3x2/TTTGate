import assert from "node:assert/strict";
import net from "node:net";
import {setTimeout as delay} from "node:timers/promises";
import {ExternalPortServerPool} from "../../src/server/ExternalPortServerPool";
import SocketState from "../../src/util/SocketState";
import {getFreePort, sendTcpAndReceive} from "../helpers/network";

const until = async (condition: () => boolean) => {
    const deadline = Date.now() + 5000;
    while(!condition()) {
        if(Date.now() >= deadline) throw new Error("Listener state did not settle");
        await delay(10);
    }
};

const rejectConnection = async (port: number) => {
    const errors: string[] = [];
    await new Promise<void>((resolve) => {
        const socket = net.createConnection({host: "127.0.0.1", port});
        socket.on("error", (error: NodeJS.ErrnoException) => errors.push(error.code || "unknown"));
        socket.once("connect", () => socket.end("rejected data"));
        socket.resume();
        socket.once("close", () => resolve());
    });
    assert.ok(errors.every((code) => code === "ECONNRESET"), JSON.stringify(errors));
    await new Promise<void>((resolve) => setImmediate(resolve));
    await new Promise<void>((resolve) => setImmediate(resolve));
};

const main = async () => {
    const mode = process.argv[2];
    const port = await getFreePort();
    const pool = ExternalPortServerPool.create([]);
    const sessions: Array<{id: number; count: number}> = [];
    const terminated: number[] = [];
    const events: Array<{id: number; state: SocketState}> = [];
    pool.OnNewSessionCallback = (id) => sessions.push({id, count: pool.getServerStatus(port).sessions});
    pool.OnTerminateSessionCallback = (id) => terminated.push(id);
    pool.OnHandlerEventCallback = (id, state, bundle) => {
        events.push({id, state});
        if(state === SocketState.Receive) pool.send(id, bundle!.data!);
    };
    try {
        await pool.startServer({forwardPort: port, protocol: "tcp", destinationAddress: "127.0.0.1",
            destinationPort: 12345, tls: false, keepAlive: 0, inactiveOnStartup: mode === "startup"});
        if(mode === "timeout") {
            assert.equal(await pool.active(port, 0.05), true);
            await until(() => !pool.getServerStatus(port).active);
        }
        assert.equal(pool.getServerStatus(port).active, false);
        await rejectConnection(port);
        assert.equal(pool.getServerStatus(port).online, true);
        assert.equal(pool.getServerStatus(port).sessions, 0);
        assert.equal((pool as any)._handlerMap.size, 0);
        assert.deepEqual(sessions, []);
        assert.deepEqual(terminated, []);
        assert.deepEqual(events, []);

        assert.equal(await pool.active(port, 0), true);
        const payload = Buffer.from(`reactivated-${mode}`);
        assert.deepEqual(await sendTcpAndReceive(port, payload), payload);
        await until(() => terminated.length > 0 && (pool as any)._handlerMap.size === 0);
        await new Promise<void>((resolve) => setImmediate(resolve));
        await new Promise<void>((resolve) => setImmediate(resolve));
        assert.equal(sessions.length, 1);
        assert.equal(sessions[0].count, 1);
        assert.deepEqual(terminated, [sessions[0].id]);
        assert.ok(events.every((event) => event.id === sessions[0].id));
        assert.equal(pool.getServerStatus(port).sessions, 0);
        console.log(`RESULT ${JSON.stringify({mode, rejectedSessions: 0, rejectedEvents: 0,
            rejectedTerminations: 0, acceptedSessions: sessions.length, terminations: terminated.length,
            finalSessions: pool.getServerStatus(port).sessions, finalRegistered: (pool as any)._handlerMap.size})}`);
    } finally {
        await pool.dispose();
    }
};

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});

import assert from "node:assert/strict";
import fs from "node:fs";
import net from "node:net";
import {once} from "node:events";
import {setTimeout as delay} from "node:timers/promises";
import {TCPServer} from "../../src/util/TCPServer";
import {SocketHandler} from "../../src/util/SocketHandler";
import {FileCache} from "../../src/util/FileCache";
import {getFreePort} from "../helpers/network";
import {createTestRoot, applyTestRoot, cleanupTestRoot} from "../helpers/runtime";

const PREFIX_BYTES = 128 * 1024;
const until = async (condition: () => boolean) => {
    const deadline = Date.now() + 12_000;
    while(!condition()) {
        if(Date.now() >= deadline) throw new Error("Cache/socket condition did not settle");
        await delay(5);
    }
};

const main = async () => {
    const mode = process.argv[2];
    const root = await createTestRoot("cache-read-19");
    applyTestRoot(root.rootDir);
    const port = await getFreePort();
    const server = TCPServer.create({port, keepAlive: 0});
    const clients: net.Socket[] = [];
    const owners: Map<number, SocketHandler> = (server as any)._idHandlerMap;
    const baseGlobal = SocketHandler.globalFileCacheSize;
    const open = async () => {
        const previous = new Set(owners.keys());
        const peer = net.createConnection({host: "127.0.0.1", port});
        clients.push(peer);
        const chunks: Buffer[] = [];
        let receivedBytes = 0;
        let closed = false;
        peer.on("data", (data) => { chunks.push(data); receivedBytes += data.length; });
        peer.on("error", () => {});
        peer.once("close", () => { closed = true; });
        peer.pause();
        await once(peer, "connect");
        await until(() => owners.size > previous.size);
        const handler = [...owners.values()].find((value) => !previous.has(value.id))!;
        handler.setBufferSizeLimit(1024);
        const writes: Array<{label: string; success: boolean; error: boolean}> = [];
        const send = (label: string, data: Buffer) => handler.sendData(data, (_handler, success, error) => {
            writes.push({label, success, error: error instanceof Error});
        });
        return {peer, handler, chunks, writes, send, receivedBytes: () => receivedBytes, closed: () => closed};
    };
    let report: object | undefined;
    try {
        await new Promise<void>((resolve, reject) => server.start((error) => error ? reject(error) : resolve()));
        const victim = await open();
        const prefix = Buffer.alloc(PREFIX_BYTES, 0x41);
        const current = Buffer.alloc(4096, 0x42);
        const follower = Buffer.alloc(6144, 0x43);
        // Use the actual Writable cork boundary, not a replaced write method.
        // Pausing a loopback peer alone does not guarantee local backpressure.
        victim.handler.socket.cork();
        victim.send("prefix", prefix);
        victim.send("current", current);
        const hasFollower = mode === "followers" || mode === "success";
        if(hasFollower) victim.send("follower", follower);
        assert.equal(victim.handler.pendingFileCacheBytes, current.length + (hasFollower ? follower.length : 0), JSON.stringify({
            state: victim.handler.state, writes: victim.writes, pending: victim.handler.pendingWriteBytes,
            queue: (victim.handler as any)._waitQueue.size(), pumping: (victim.handler as any)._inRunWriteBuffer,
            full: (victim.handler as any)._isFullNativeBuffer, nativePending: victim.handler.socket.writableLength,
        }));
        assert.ok((victim.handler as any)._waitQueue.size() > 0, "Actual file-backed queue required");
        const cache: FileCache = (victim.handler as any)._fileCache;
        assert.ok(fs.existsSync(cache.filePath));
        let survivor: Awaited<ReturnType<typeof open>> | undefined;
        if(mode === "survivor") {
            survivor = await open();
            survivor.handler.socket.cork();
            survivor.send("prefix", prefix);
            survivor.send("pending", Buffer.alloc(8192, 0x44));
            assert.equal(survivor.handler.pendingFileCacheBytes, 8192);
        }
        if(mode === "followers") {
            assert.equal(cache.remove((victim.handler as any)._waitQueue.front().cacheID), true);
        } else if(mode === "short-read") {
            fs.truncateSync(cache.filePath, 2);
        } else if(mode !== "success") {
            cache.deleteSync();
        }
        const drains: boolean[] = [];
        victim.handler.addOnceDrainListener((_handler, success) => drains.push(success));
        victim.peer.resume();
        victim.handler.socket.uncork();
        await until(() => victim.writes.length === (hasFollower ? 3 : 2) && drains.length > 0);
        if(victim.handler.isEnd()) await until(victim.closed);
        if(mode === "success") await until(() => victim.receivedBytes() === prefix.length + current.length + follower.length);
        const received = Buffer.concat(victim.chunks);
        report = {
            mode, writes: victim.writes, drains, sendLength: victim.handler.sendLength,
            pending: victim.handler.pendingWriteBytes, cacheBytes: victim.handler.pendingFileCacheBytes,
            ended: victim.handler.isEnd(), ownerRetained: owners.has(victim.handler.id),
            globalBytes: SocketHandler.globalFileCacheSize - baseGlobal,
            survivorBytes: survivor?.handler.pendingFileCacheBytes ?? 0,
            survivorLive: survivor ? owners.has(survivor.handler.id) && !survivor.handler.isEnd() : true,
            payloadValid: mode === "success" ? received.equals(Buffer.concat([prefix, current, follower]))
                : received.length <= prefix.length && received.every((byte) => byte === 0x41),
        };
    } finally {
        clients.forEach((socket) => socket.destroy());
        if(!server.isEnd()) await new Promise<void>((resolve) => server.stop(() => resolve()));
        await cleanupTestRoot(root);
    }
    assert.equal(SocketHandler.globalFileCacheSize, baseGlobal);
    console.log(`RESULT ${JSON.stringify(report)}`);
};

main().catch((error) => { console.error(error); process.exitCode = 1; });

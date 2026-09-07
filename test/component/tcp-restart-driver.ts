import assert from "node:assert/strict";
import net from "node:net";
import {TCPServer} from "../../src/util/TCPServer";
import SocketState from "../../src/util/SocketState";
import {getFreePort, sendTcpAndReceive} from "../helpers/network";

const main = async () => {
    const mode = process.argv[2];
    const port = await getFreePort();
    const server = TCPServer.create({port, keepAlive: 0});
    const counts = {listen: 0, closed: 0, bound: 0, start: 0, stop: 0};
    let errorEvent: (() => void) | undefined;
    let restartOnClose: (() => void) | undefined;
    server.setOnServerEvent((instance, state) => {
        if(state === SocketState.Listen) counts.listen++;
        if(state === SocketState.Bound) counts.bound++;
        if(state === SocketState.Closed) {
            counts.closed++;
            if(instance.getError()) errorEvent?.();
            const restart = restartOnClose;
            restartOnClose = undefined;
            restart?.();
        }
    });
    server.setOnHandlerEvent((handler, state, data) => {
        if(state === SocketState.Receive) handler.sendData(data);
    });
    const start = () => new Promise<Error | undefined>((resolve) => server.start((error) => {
        counts.start++;
        resolve(error);
    }));
    const stop = () => new Promise<Error | undefined>((resolve) => server.stop((error) => {
        counts.stop++;
        resolve(error);
    }));
    const echo = async () => {
        const data = Buffer.from(`restart-${mode}`);
        assert.deepEqual(await sendTcpAndReceive(port, data), data);
    };
    let blocker: net.Server | undefined;
    try {
        if(mode === "cycles") {
            for(let cycle = 1; cycle <= 3; cycle++) {
                assert.equal(await start(), undefined);
                assert.equal(server.isListen(), true);
                await echo();
                assert.equal(await stop(), undefined);
                assert.equal(server.isEnd(), true);
                assert.deepEqual(counts, {listen: cycle, closed: cycle, bound: cycle, start: cycle, stop: cycle});
            }
        } else if(mode === "close-callback") {
            assert.equal(await start(), undefined);
            const restarted = new Promise<Error | undefined>((resolve) => {
                restartOnClose = () => { start().then(resolve); };
            });
            assert.equal(await stop(), undefined);
            assert.equal(await restarted, undefined);
            assert.equal(server.isListen(), true);
            await echo();
            assert.equal(await stop(), undefined);
            assert.deepEqual(counts, {listen: 2, closed: 2, bound: 1, start: 2, stop: 2});
        } else {
            assert.equal(await start(), undefined);
            assert.equal(await stop(), undefined);
            blocker = net.createServer();
            await new Promise<void>((resolve, reject) => {
                blocker!.once("error", reject);
                blocker!.listen(port, resolve);
            });
            const observedError = new Promise<void>((resolve) => { errorEvent = resolve; });
            if(mode === "collision-callback") {
                const error = await start() as NodeJS.ErrnoException;
                assert.equal(error?.code, "EADDRINUSE");
            } else {
                server.start();
            }
            await observedError;
            assert.equal(server.isEnd(), true);
            assert.equal(server.getError()?.code, "EADDRINUSE");
            assert.equal(counts.closed, 2);
            await new Promise<void>((resolve, reject) => blocker!.close((error) => error ? reject(error) : resolve()));
            blocker = undefined;
            assert.equal(await start(), undefined);
            assert.equal(server.isListen(), true);
            assert.equal(server.getError(), undefined);
            await echo();
            assert.equal(await stop(), undefined);
            assert.deepEqual(counts, {listen: 2, closed: 3, bound: 1,
                start: mode === "collision-callback" ? 3 : 2, stop: 2});
        }
        console.log(`RESULT ${JSON.stringify({mode, ...counts})}`);
    } finally {
        if(blocker) await new Promise<void>((resolve) => blocker!.close(() => resolve()));
        if(!server.isEnd()) await stop();
    }
};

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});

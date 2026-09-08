import net from 'node:net';
import {once} from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {assertPayload, bounded, collectToEnd, digest, streamPayload, waitUntil as pollUntil, assertCacheRecordReads, waitForSocketEvent} from '../../fixtures/large-transfer-peer';
import {createTunnelHarness} from '../../helpers/tunnelHarness';
import {SocketHandler} from '../../../src/util/SocketHandler';
import {FileCache} from '../../../src/util/FileCache';
import {ResourcePolicyRegistry} from '../../../src/util/ResourcePolicy';
import TTTClient from '../../../src/client/TTTClient';
import {TunnelClient} from '../../../src/client/TunnelClient';
import SocketState from '../../../src/util/SocketState';

jest.setTimeout(195_000);

test.each(['corrupt', 'extra'])('actual endpoint %s response exposes verifier sensitivity', async mode => {
    const expected = Buffer.from('owned-integrity-control');
    const sockets: net.Socket[] = [];
    let requests = 0;
    const server = net.createServer(socket => {
        sockets.push(socket); socket.on('error', () => {});
        const parts: Buffer[] = []; let length = 0, sent = false;
        socket.on('data', bytes => {
            parts.push(Buffer.from(bytes)); length += bytes.length;
            if(length < expected.length || sent) return;
            sent = true; requests++;
            const response = Buffer.concat(parts);
            if(mode === 'corrupt') { response[0] ^= 1; socket.end(response); }
            else socket.end(Buffer.concat([response, Buffer.from('!')]));
        });
    });
    try {
        server.listen(0, '127.0.0.1'); await once(server, 'listening');
        const client = net.createConnection({host: '127.0.0.1', port: (server.address() as net.AddressInfo).port});
        sockets.push(client); client.on('error', () => {});
        const received = collectToEnd(client);
        await once(client, 'connect'); client.write(expected);
        const actual = await bounded(received, 5000, 'sensitivity peer');
        expect(requests).toBe(1);
        expect(() => assertPayload(actual, expected)).toThrow('Payload integrity mismatch');
    } finally {
        sockets.forEach(socket => socket.destroy());
        await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
});

test('32MiB actual tunnel roundtrip spills and reads owned cache in both directions then recovers', async () => {
    const evidence = process.env.TTTGATE_LARGE53_EVIDENCE ?? fs.mkdtempSync(path.join(os.tmpdir(), 'large53-evidence-'));
    const payload = Buffer.alloc(32 * 1024 * 1024);
    for(let i = 0; i < payload.length; i++) payload[i] = (i * 31 + (i >>> 16)) & 255;
    Buffer.from('LARGE53-FIRST').copy(payload);
    Buffer.from('LARGE53-LAST').copy(payload, payload.length - 12);
    const priorGlobal = SocketHandler.maxGlobalMemoryBufferSize;
    const policy = ResourcePolicyRegistry.current();
    const cancellation = new AbortController();
    const cacheIdentity = new Map<FileCache, number>();
    const facts: any = {payloadLength: payload.length, sha256: digest(payload), priorGlobal,
        workBudgetMs: 180000, pressureBudgetMs: 30000, recoveryBudgetMs: 60000, policy,
        phases: [], highWater: {}, cacheWrites: [], cacheReads: []};
    const sockets: net.Socket[] = [], cacheInstances = new Set<FileCache>(), handlers = new Set<SocketHandler>();
    const originalWrite = FileCache.prototype.writeSync, originalRead = FileCache.prototype.readSync;
    const originalSend = SocketHandler.prototype.sendData;
    const originalStart = TTTClient.prototype.start, originalDestroy = SocketHandler.prototype.destroy;
    const originalRemove = FileCache.prototype.remove, originalDelete = FileCache.prototype.deleteSync;
    const originalClose = TunnelClient.prototype.closeEndPointSession, originalTerminate = TunnelClient.prototype.terminateEndPointSession;
    const clients = new Set<any>(), restores: Array<() => void> = [];
    const cacheRecords = new Map<FileCache, Map<number, {id: number; length: number; capacity: number; read: boolean}>>();
    const catalog = new Map<SocketHandler, {role: string; clientId?: string; sid?: number}>();
    const eventsWrapped = new Set<SocketHandler>();
    let responseProgress: (() => unknown) | undefined;
    const started = Date.now();
    facts.terminalTrace = []; facts.cacheRemovals = [];
    let harness: Awaited<ReturnType<typeof createTunnelHarness>> | undefined;
    let endpointSocket: net.Socket | undefined, endpoint: net.Server | undefined;
    let phase = 'setup', pressureResolve: ((value: any) => void) | undefined;
    const tuple = (socket: net.Socket) => ({localAddress: socket.localAddress, localPort: socket.localPort,
        remoteAddress: socket.remoteAddress, remotePort: socket.remotePort});
    const refreshRoles = () => {
        for(const client of clients) {
            const id = client._clientOption?.clientId;
            for(const [sid, handler] of client._tunnelClient?._activatedSessionDataHandlerMap ?? []) catalog.set(handler, {role: 'client-data', clientId: id, sid});
            for(const [sid, handler] of client._endPointClientPool?._endPointClientMap ?? []) catalog.set(handler, {role: 'client-endpoint', clientId: id, sid});
        }
        const server: any = harness?.getServer();
        for(const pool of server?.tunnelServer?._clientHandlerPoolMap?.values() ?? []) {
            for(const [sid, handler] of pool._activatedSessionHandlerMap_ ?? []) catalog.set(handler, {role: 'server-data', clientId: pool.clientId, sid});
        }
        for(const [sid, handler] of server?._externalPortServerPool?._handlerMap ?? []) {
            const pair = [...catalog.values()].find(value => value.sid === sid && value.clientId);
            catalog.set(handler, {role: 'server-external', sid, clientId: pair?.clientId});
        }
    };
    const snapshot = (handler: SocketHandler) => {
        const value: any = handler, cache = value._fileCache as FileCache | null;
        return {id: handler.id, ...catalog.get(handler), tuple: tuple(handler.socket), state: value._state,
            dataState: value.dataHandlerState, pendingWrite: handler.pendingWriteBytes, pendingFile: handler.pendingFileCacheBytes,
            queueItems: value._waitQueue?.size(), inFlightWrites: value._inFlightWriteCount, nativeWritable: handler.socket.writableLength,
            sendLength: handler.sendLength, receiveLength: handler.receiveLength, endLength: value.endLength,
            closeWait: value.closeWait, closeInitiated: value.closeInitiated, paused: handler.socket.isPaused(),
            readableEnded: handler.socket.readableEnded, destroyed: handler.socket.destroyed,
            cacheFile: cache?.filePath, cacheAllocated: cache?.cacheSize};
    };
    const trace = (event: string, sid?: number, direct?: SocketHandler) => {
        refreshRoles();
        facts.terminalTrace.push({event, phase, elapsedMs: Date.now() - started, sid,
            response: responseProgress?.(), endpoint: endpointSocket ? {...tuple(endpointSocket), paused: endpointSocket.isPaused(),
                readableEnded: endpointSocket.readableEnded, destroyed: endpointSocket.destroyed, bytesRead: endpointSocket.bytesRead, bytesWritten: endpointSocket.bytesWritten} : undefined,
            handlers: [...new Set([...catalog.keys(), ...(direct ? [direct] : [])])].filter(handler => sid === undefined || catalog.get(handler)?.sid === sid || handler === direct).map(snapshot)});
    };
    let requestResolve!: (value: {length: number; sha256: string}) => void;
    const requestDone = new Promise<{length: number; sha256: string}>(resolve => { requestResolve = resolve; });
    requestDone.catch(() => {});
    let sender: Promise<void> | undefined, responseSender: Promise<void> | undefined, work: Promise<void> | undefined;
    const waitUntil = (predicate: () => boolean, ms: number, label: string) => pollUntil(predicate, ms, label, cancellation.signal);
    const pressure = () => {
        const waiting = new Promise<any>(resolve => { pressureResolve = resolve; });
        waiting.catch(() => {});
        return bounded(waiting, 30000, `${phase} cache pressure`, cancellation.signal);
    };
    try {
        TTTClient.prototype.start = function() {
            const result = originalStart.call(this); clients.add(this);
            const pool = (this as any)._endPointClientPool;
            const event = pool.onEndPointHandlerEvent;
            pool.onEndPointHandlerEvent = function(...args: any[]) {
                const terminal = args[2] === SocketState.End || args[2] === SocketState.Closed;
                if(terminal) trace('endpoint-terminal-before', args[0], args[1]);
                try { return event.apply(this, args); } finally { if(terminal) trace('endpoint-terminal-after', args[0], args[1]); }
            };
            restores.push(() => { pool.onEndPointHandlerEvent = event; });
            return result;
        };
        TunnelClient.prototype.closeEndPointSession = function(...args) {
            trace('tunnel-close-before', args[0]);
            try { return originalClose.apply(this, args); } finally { trace('tunnel-close-after', args[0]); }
        };
        TunnelClient.prototype.terminateEndPointSession = function(...args) {
            trace('tunnel-terminate-before', args[0]);
            try { return originalTerminate.apply(this, args); } finally { trace('tunnel-terminate-after', args[0]); }
        };
        SocketHandler.prototype.destroy = function() {
            trace('handler-destroy-before', (this as any).sessionID, this);
            try { return originalDestroy.call(this); } finally { trace('handler-destroy-after', (this as any).sessionID, this); }
        };
        FileCache.prototype.remove = function(id) {
            const record = cacheRecords.get(this)?.get(id);
            facts.cacheRemovals.push({phase, operation: 'remove', elapsedMs: Date.now() - started, file: this.filePath,
                id, unreadLogical: record && !record.read ? record.length : 0});
            const result = originalRemove.call(this, id);
            if(result) cacheRecords.get(this)?.delete(id);
            return result;
        };
        FileCache.prototype.deleteSync = function() {
            const records = [...(cacheRecords.get(this)?.values() ?? [])].filter(record => !record.read);
            refreshRoles();
            facts.cacheRemovals.push({phase, operation: 'delete', elapsedMs: Date.now() - started, file: this.filePath,
                unreadLogical: records.reduce((sum, record) => sum + record.length, 0), unreadRecords: records,
                owners: [...catalog.keys()].filter(handler => (handler as any)._fileCache === this).map(snapshot)});
            const result = originalDelete.call(this);
            cacheRecords.get(this)?.clear();
            return result;
        };
        FileCache.prototype.writeSync = function(buffer) {
            const record = originalWrite.call(this, buffer);
            if(record.id >= 0) {
                cacheInstances.add(this);
                if(!cacheIdentity.has(this)) cacheIdentity.set(this, cacheIdentity.size + 1);
                if(!cacheRecords.has(this)) cacheRecords.set(this, new Map());
                cacheRecords.get(this)!.set(record.id, {id: record.id, length: record.length, capacity: record.capacity, read: false});
                facts.cacheWrites.push({phase, instance: cacheIdentity.get(this), file: this.filePath, id: record.id, length: record.length});
            }
            return record;
        };
        FileCache.prototype.readSync = function(id) {
            const result = originalRead.call(this, id);
            const record = cacheRecords.get(this)?.get(id);
            if(result && record) {
                if(result.length !== record.length) throw new Error('Cache record logical read length mismatch');
                record.read = true;
            }
            if(result) facts.cacheReads.push({phase, instance: cacheIdentity.get(this), file: this.filePath, id, length: result.length});
            return result;
        };
        SocketHandler.prototype.sendData = function(...args: Parameters<SocketHandler['sendData']>) {
            handlers.add(this);
            if(!eventsWrapped.has(this)) {
                eventsWrapped.add(this);
                const event = (this as any)._event;
                this.onSocketEvent = function(...eventArgs: any[]) {
                    const terminal = eventArgs[1] === SocketState.End || eventArgs[1] === SocketState.Closed;
                    if(terminal) trace('handler-terminal-before', (eventArgs[0] as any).sessionID, eventArgs[0]);
                    try { return event.apply(this, eventArgs); } finally { if(terminal) trace('handler-terminal-after', (eventArgs[0] as any).sessionID, eventArgs[0]); }
                };
                restores.push(() => { this.onSocketEvent = event; });
            }
            const result = originalSend.apply(this, args);
            const previous = facts.highWater[phase] ?? {pendingWriteBytes: 0, pendingFileCacheBytes: 0, globalMemory: 0, globalCache: 0};
            facts.highWater[phase] = {pendingWriteBytes: Math.max(previous.pendingWriteBytes, this.pendingWriteBytes),
                pendingFileCacheBytes: Math.max(previous.pendingFileCacheBytes, this.pendingFileCacheBytes),
                globalMemory: Math.max(previous.globalMemory, SocketHandler.globalMemoryBufferSize),
                globalCache: Math.max(previous.globalCache, SocketHandler.globalFileCacheSize)};
            const cache = (this as any)._fileCache as FileCache | undefined;
            if(pressureResolve && cache && cacheInstances.has(cache) && this.pendingFileCacheBytes > 0 && cache.cacheSize > 0) {
                trace('pressure-observed', (this as any).sessionID, this);
                const observation = {phase, handlerId: this.id, file: cache.filePath,
                    localLimit: this.bufferSizeLimit, pendingWriteBytes: this.pendingWriteBytes,
                    pendingFileCacheBytes: this.pendingFileCacheBytes, globalMemory: SocketHandler.globalMemoryBufferSize,
                    globalCache: SocketHandler.globalFileCacheSize, cacheAllocatedBytes: cache.cacheSize, logicalCacheBytes: [...(cacheRecords.get(cache)?.values() ?? [])].reduce((sum, record) => sum + record.length, 0), cacheInstance: cacheIdentity.get(cache),
                    nativeWritableLength: this.socket.writableLength, backpressured: this.isBackpressured};
                const done = pressureResolve; pressureResolve = undefined; done(observation);
            }
            return result;
        };
        harness = await createTunnelHarness({serverOptionOverride: {sessionTtlMs: 3600000}, clients: [
            {clientId: 'large-owner', clientSecret: 'owned-large-secret',
                tunnelingOptionOverride: {bufferLimitOnServer: 16, bufferLimitOnClient: 16},
                endpointFactory: async () => {
                    endpoint = net.createServer(socket => {
                        endpointSocket = socket; sockets.push(socket); socket.on('error', () => {});
                        const hash = createHash('sha256'); let received = 0;
                        socket.on('data', data => {
                            received += data.length; hash.update(data);
                            if(received === payload.length) requestResolve({length: received, sha256: hash.digest('hex')});
                        });
                        socket.pause();
                    });
                    endpoint.listen(0, '127.0.0.1'); await once(endpoint, 'listening');
                    return {port: (endpoint.address() as net.AddressInfo).port, close: async () => {
                        endpointSocket?.destroy();
                        if(endpoint?.listening) await new Promise<void>((resolve, reject) => endpoint!.close(error => error ? reject(error) : resolve()));
                    }};
                }},
            {clientId: 'healthy-owner', clientSecret: 'owned-healthy-secret',
                tunnelingOptionOverride: {bufferLimitOnServer: 16, bufferLimitOnClient: 16}},
        ]});
        await harness.start();
        SocketHandler.GlobalMemCacheLimit = 1048576;
        expect(SocketHandler.maxGlobalMemoryBufferSize).toBe(1048576);
        expect(ResourcePolicyRegistry.current()).toEqual(policy);
        expect(await harness.sendAndReceive('healthy-baseline', 'healthy-owner')).toEqual(Buffer.from('healthy-baseline'));
        await waitUntil(() => SocketHandler.globalMemoryBufferSize === 0 && SocketHandler.globalFileCacheSize === 0, 60000, 'baseline accounting');
        const baseline = {memory: SocketHandler.globalMemoryBufferSize, cache: SocketHandler.globalFileCacheSize};
        facts.baseline = baseline;
        work = (async () => {
            const client = net.createConnection({host: '127.0.0.1', port: harness!.clients[0].forwardPort});
            sockets.push(client); client.on('error', () => {});
            const response = collectToEnd(client, read => { responseProgress = read; }, cancellation.signal); response.catch(() => {}); client.pause();
            await waitForSocketEvent(client, 'connect', cancellation.signal);
            phase = 'request'; const requestPressure = pressure();
            sender = bounded(streamPayload(client, payload, cancellation.signal), 60000, 'request sender', cancellation.signal); sender.catch(() => {});
            const requestObservation = await requestPressure; facts.phases.push(requestObservation);
            expect(requestObservation.localLimit).toBe(16 * 1024 * 1024);
            expect(fs.existsSync(requestObservation.file)).toBe(true);
            expect(path.relative(harness!.rootDir, requestObservation.file).startsWith('..')).toBe(false);
            expect(await harness!.sendAndReceive('healthy-request-pressure', 'healthy-owner')).toEqual(Buffer.from('healthy-request-pressure'));
            expect(endpointSocket?.isPaused()).toBe(true);
            endpointSocket!.resume();
            trace('request-reader-resumed');
            await sender;
            const receivedRequest = await bounded(requestDone, 60000, 'request receive', cancellation.signal);
            assertPayload(receivedRequest, payload); facts.request = receivedRequest;
            await waitUntil(() => SocketHandler.globalFileCacheSize === baseline.cache && SocketHandler.globalMemoryBufferSize === baseline.memory, 60000, 'request recovery');
            phase = 'response'; const responsePressure = pressure();
            responseSender = bounded(streamPayload(endpointSocket!, payload, cancellation.signal).then(() => { endpointSocket!.end(); }), 60000, 'response sender', cancellation.signal);
            responseSender.catch(() => {});
            const responseObservation = await responsePressure; facts.phases.push(responseObservation);
            expect(responseObservation.localLimit).toBe(16 * 1024 * 1024);
            expect(fs.existsSync(responseObservation.file)).toBe(true);
            expect(path.relative(harness!.rootDir, responseObservation.file).startsWith('..')).toBe(false);
            expect(await harness!.sendAndReceive('healthy-response-pressure', 'healthy-owner')).toEqual(Buffer.from('healthy-response-pressure'));
            expect(client.isPaused()).toBe(true); client.resume();
            trace('response-reader-resumed');
            await responseSender;
            const receivedResponse = await bounded(response, 60000, 'full response FIN', cancellation.signal);
            assertPayload(receivedResponse, payload); facts.response = receivedResponse;
            await waitUntil(() => SocketHandler.globalMemoryBufferSize === baseline.memory && SocketHandler.globalFileCacheSize === baseline.cache &&
                harness!.getServer()!.externalServerStatuses().every(status => status.sessions === 0), 60000, 'final logical cleanup');
            facts.recovered = {memory: SocketHandler.globalMemoryBufferSize, cache: SocketHandler.globalFileCacheSize};
            for(const observation of facts.phases) {
                const writes = facts.cacheWrites.filter((entry: any) => entry.instance === observation.cacheInstance && entry.file === observation.file);
                const reads = facts.cacheReads.filter((entry: any) => entry.instance === observation.cacheInstance && entry.file === observation.file);
                assertCacheRecordReads(writes, reads);
            }
            expect(await harness!.sendAndReceive('healthy-after-recovery', 'healthy-owner')).toEqual(Buffer.from('healthy-after-recovery'));
            facts.passed = true;
        })();
        work.catch(() => {}); await bounded(work, 180000, 'whole transfer work', cancellation.signal);
    } catch(error) { trace('failure-before-teardown'); facts.failure = String(error); facts.partialResponse = responseProgress?.(); throw error; }
    finally {
        phase = 'teardown';
        cancellation.abort(new Error('Owned large transfer cleanup'));
        pressureResolve = undefined;
        sockets.forEach(socket => { socket.resume(); socket.destroy(); });
        try { await harness?.dispose(); }
        finally {
            await Promise.allSettled([work, sender, responseSender].filter((operation): operation is Promise<void> => operation !== undefined));
            facts.workSettledBeforeExit = true;
            SocketHandler.GlobalMemCacheLimit = priorGlobal;
            FileCache.prototype.writeSync = originalWrite; FileCache.prototype.readSync = originalRead;
            SocketHandler.prototype.sendData = originalSend;
            FileCache.prototype.remove = originalRemove; FileCache.prototype.deleteSync = originalDelete;
            SocketHandler.prototype.destroy = originalDestroy; TTTClient.prototype.start = originalStart;
            TunnelClient.prototype.closeEndPointSession = originalClose; TunnelClient.prototype.terminateEndPointSession = originalTerminate;
            restores.forEach(restore => restore());
            facts.restoredGlobal = SocketHandler.maxGlobalMemoryBufferSize;
            facts.cacheDisposed = [...cacheInstances].map(cache => ({file: cache.filePath, exists: fs.existsSync(cache.filePath), cacheAllocatedBytes: cache.cacheSize, logicalCacheBytes: [...(cacheRecords.get(cache)?.values() ?? [])].reduce((sum, record) => sum + record.length, 0)}));
            fs.writeFileSync(path.join(evidence, 'facts.json'), JSON.stringify(facts, null, 2));
            process.stdout.write(`Large-transfer evidence: ${evidence}\n`);
            if(facts.passed) {
                expect(facts.cacheDisposed.every((entry: any) => !entry.exists && entry.logicalCacheBytes === 0)).toBe(true);
                expect(SocketHandler.maxGlobalMemoryBufferSize).toBe(priorGlobal);
            }
        }
    }
});


test('owned sender settles on native close while waiting for corked drain', async () => {
    const sockets: net.Socket[] = [];
    const server = net.createServer(socket => { sockets.push(socket); socket.on('error', () => {}); socket.pause(); });
    try {
        server.listen(0, '127.0.0.1'); await once(server, 'listening');
        const socket = net.createConnection({host: '127.0.0.1', port: (server.address() as net.AddressInfo).port});
        sockets.push(socket); socket.on('error', () => {}); await once(socket, 'connect'); socket.cork();
        const sending = streamPayload(socket, Buffer.alloc(128 * 1024)); sending.catch(() => {});
        socket.destroy();
        await expect(bounded(sending, 200, 'sender-close control')).rejects.toThrow(/closed/i);
    } finally { sockets.forEach(socket => socket.destroy()); await new Promise<void>(resolve => server.close(() => resolve())); }
});

test('pressure cancellation settles parallel waits and clears their actual timers', async () => {
    const controller = new AbortController(), reason = new Error('owned-pressure-failure');
    const timers = new Set<ReturnType<typeof setTimeout>>();
    const create = global.setTimeout, clear = global.clearTimeout;
    global.setTimeout = ((fn: (...args: any[]) => void, ms?: number, ...args: any[]) => {
        const timer = create(() => { timers.delete(timer); fn(...args); }, ms); timers.add(timer); return timer;
    }) as typeof setTimeout;
    global.clearTimeout = ((timer: any) => { timers.delete(timer); clear(timer); }) as typeof clearTimeout;
    try {
        const waiting = (bounded as any)(new Promise(() => {}), 1000, 'pending pressure', controller.signal) as Promise<void>;
        const polling = (pollUntil as any)(() => false, 1000, 'parallel recovery', controller.signal) as Promise<void>;
        waiting.catch(() => {}); polling.catch(() => {}); controller.abort(reason);
        const outcomes = await bounded(Promise.allSettled([waiting, polling]), 200, 'cancellation control');
        expect(outcomes.every(result => result.status === 'rejected')).toBe(true);
        expect(timers.size).toBe(0);
    } finally { for(const timer of timers) clear(timer); global.setTimeout = create; global.clearTimeout = clear; }
});

test.each(['instance', 'record', 'length'])('logical cache read mismatch in %s cannot pass file-existence verification', field => {
    const write = {instance: 1, file: 'owned.cache', id: 7, length: 4};
    const read = {...write};
    if(field === 'instance') read.instance = 2;
    if(field === 'record') read.id = 8;
    if(field === 'length') read.length = 3;
    expect(() => assertCacheRecordReads([write], [read])).toThrow(/cache record/i);
    expect(() => assertCacheRecordReads([write], [write])).not.toThrow();
});

test('bounded retains an undefined rejection rather than reporting successful completion', async () => {
    await expect(bounded(Promise.reject(undefined), 1000, 'undefined rejection')).rejects.toBeUndefined();
});
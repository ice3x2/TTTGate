import net from 'node:net';
import {setTimeout as delay} from 'node:timers/promises';
import {createHash} from 'node:crypto';

export const digest = (buffer: Buffer) => createHash('sha256').update(buffer).digest('hex');

export function bounded<T>(operation: Promise<T>, milliseconds: number, label: string, signal?: AbortSignal): Promise<T> {
    const result = new Promise<T>((resolve, reject) => {
        let settled = false;
        const finish = (success: boolean, value?: unknown) => {
            if(settled) return; settled = true;
            clearTimeout(timer); signal?.removeEventListener('abort', abort);
            if(success) resolve(value as T); else reject(value);
        };
        const abort = () => finish(false, signal?.reason ?? new Error(`${label} cancelled`));
        const timer = setTimeout(() => finish(false, new Error(`${label} deadline exceeded`)), milliseconds);
        signal?.addEventListener('abort', abort, {once: true});
        operation.then(value => finish(true, value), error => finish(false, error));
        if(signal?.aborted) abort();
    });
    result.catch(() => {}); return result;
}

export function waitForSocketEvent(socket: net.Socket, event: 'connect' | 'drain', signal?: AbortSignal): Promise<void> {
    return new Promise<void>((resolve, reject) => {
        const cleanup = () => { socket.off(event, ready); socket.off('error', failed); socket.off('close', closed); signal?.removeEventListener('abort', abort); };
        const ready = () => { cleanup(); resolve(); };
        const failed = (error: unknown) => { cleanup(); reject(error); };
        const closed = () => failed(new Error(`Socket closed before ${event}`));
        const abort = () => failed(signal?.reason ?? new Error('Socket wait cancelled'));
        socket.once(event, ready); socket.once('error', failed); socket.once('close', closed);
        signal?.addEventListener('abort', abort, {once: true});
        if(signal?.aborted) abort(); else if(socket.destroyed) closed();
    });
}

export async function streamPayload(socket: net.Socket, payload: Buffer, signal?: AbortSignal): Promise<void> {
    for(let offset = 0; offset < payload.length; offset += 64 * 1024) {
        if(signal?.aborted) throw signal.reason;
        if(socket.destroyed) throw new Error('Socket closed before payload completion');
        if(!socket.write(payload.subarray(offset, offset + 64 * 1024))) await waitForSocketEvent(socket, 'drain', signal);
    }
}

export function collectToEnd(socket: net.Socket, observe?: (snapshot: () => {length: number; sha256: string; ended: boolean; closed: boolean; bytesRead: number; paused: boolean}) => void, signal?: AbortSignal) {
    const hash = createHash('sha256');
    let length = 0, ended = false, closed = false, finalHash: string | undefined;
    const done = new Promise<{length: number; sha256: string}>((resolve, reject) => {
        const cleanup = () => { socket.off('data', data); socket.off('error', failed); socket.off('end', end); socket.off('close', close); signal?.removeEventListener('abort', abort); };
        const data = (bytes: Buffer) => { length += bytes.length; hash.update(bytes); };
        const failed = (error: unknown) => { cleanup(); reject(error); };
        const end = () => { ended = true; finalHash = hash.digest('hex'); cleanup(); resolve({length, sha256: finalHash}); };
        const close = () => { closed = true; if(!socket.readableEnded) failed(new Error('Closed without response FIN')); };
        const abort = () => failed(signal?.reason ?? new Error('Response collection cancelled'));
        socket.on('data', data); socket.once('error', failed); socket.once('end', end); socket.once('close', close);
        signal?.addEventListener('abort', abort, {once: true});
        if(signal?.aborted) abort();
    });
    observe?.(() => ({length, sha256: finalHash ?? hash.copy().digest('hex'), ended, closed: closed || socket.destroyed, bytesRead: socket.bytesRead, paused: socket.isPaused()}));
    done.catch(() => {});
    return done;
}

export function assertPayload(actual: {length: number; sha256: string}, payload: Buffer): void {
    if(actual.length !== payload.length || actual.sha256 !== digest(payload)) {
        throw new Error(`Payload integrity mismatch: length=${actual.length}/${payload.length}, sha256=${actual.sha256}`);
    }
}


export async function waitUntil(predicate: () => boolean, ms: number, label: string, signal?: AbortSignal): Promise<void> {
    const start = Date.now();
    for(;;) {
        if(signal?.aborted) throw signal.reason;
        if(predicate()) return;
        if(Date.now() - start >= ms) throw new Error(`${label} deadline exceeded`);
        await delay(5, undefined, {signal});
    }
}
export type CacheEvidence = {instance: number; file: string; id: number; length: number};
export function assertCacheRecordReads(writes: CacheEvidence[], reads: CacheEvidence[]): void {
    if(writes.length === 0) throw new Error('Cache record writes missing');
    const remaining = [...reads];
    for(const write of writes) {
        const index = remaining.findIndex(read => read.instance === write.instance && read.file === write.file && read.id === write.id && read.length === write.length);
        if(index < 0) throw new Error(`Cache record read mismatch: ${write.instance}/${write.id}/${write.length}`);
        remaining.splice(index, 1);
    }
    if(remaining.length) throw new Error('Unexpected cache record read');
}

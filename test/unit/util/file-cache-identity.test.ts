import fs from "fs";
import os from "os";
import path from "path";
import {FileCache} from "../../../src/util/FileCache";

const withCache = (check: (cache: FileCache) => void) => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "cache-identity-20-"));
    const cache = FileCache.create(directory);
    try {
        check(cache);
    } finally {
        cache.deleteSync();
        fs.rmSync(directory, {recursive: true, force: true});
    }
};

const reuse = (cache: FileCache) => {
    const first = cache.writeSync(Buffer.from("old cached payload"));
    // Preserve primitives: CacheRecord itself is a reused mutable block object.
    const oldId = first.id;
    const oldPosition = first.position;
    const anchorData = Buffer.from("keep another block alive");
    const anchor = cache.writeSync(anchorData);
    const allocated = cache.cacheSize;
    expect(cache.remove(oldId)).toBe(true);
    const currentData = Buffer.from("new payload");
    const current = cache.writeSync(currentData);
    expect(current.position).toBe(oldPosition);
    expect(cache.cacheSize).toBe(allocated);
    expect(cache.readSync(anchor.id)).toEqual(anchorData);
    return {oldId, current, currentData, anchor, anchorData};
};

test("reusing a physical block assigns a fresh record identifier", () => withCache((cache) => {
    const {oldId, current, currentData} = reuse(cache);
    expect(current.id).not.toBe(oldId);
    expect(cache.readSync(current.id)).toEqual(currentData);
}));

test("a stale primitive ID cannot read the replacement record", () => withCache((cache) => {
    const {oldId, current, currentData} = reuse(cache);
    expect(cache.readSync(oldId)).toBeUndefined();
    expect(cache.readSync(current.id)).toEqual(currentData);
}));

test("stale removal cannot free the replacement or its live anchor", () => withCache((cache) => {
    const {oldId, current, currentData, anchor, anchorData} = reuse(cache);
    expect(cache.remove(oldId)).toBe(false);
    expect(cache.readSync(current.id)).toEqual(currentData);
    expect(cache.readSync(anchor.id)).toEqual(anchorData);
}));

test("repeated reuse keeps every released ID invalid", () => withCache((cache) => {
    const initial = cache.writeSync(Buffer.alloc(64, 1));
    const position = initial.position;
    let currentId = initial.id;
    const anchor = cache.writeSync(Buffer.from("anchor"));
    const released: number[] = [];
    for(let iteration = 0; iteration < 5; iteration++) {
        released.push(currentId);
        expect(cache.remove(currentId)).toBe(true);
        const data = Buffer.alloc(16 + iteration, iteration + 2);
        const current = cache.writeSync(data);
        expect(current.position).toBe(position);
        expect(released).not.toContain(current.id);
        for(const staleId of released) {
            expect(cache.readSync(staleId)).toBeUndefined();
            expect(cache.remove(staleId)).toBe(false);
        }
        expect(cache.readSync(current.id)).toEqual(data);
        expect(cache.readSync(anchor.id)).toEqual(Buffer.from("anchor"));
        currentId = current.id;
    }
}));

test("empty-cache allocation retains monotonic IDs and valid IO", () => withCache((cache) => {
    const firstId = cache.writeSync(Buffer.from("first")).id;
    expect(cache.remove(firstId)).toBe(true);
    const second = cache.writeSync(Buffer.from("second"));
    expect(second.id).toBeGreaterThan(firstId);
    expect(cache.readSync(firstId)).toBeUndefined();
    expect(cache.readSync(second.id)).toEqual(Buffer.from("second"));
}));

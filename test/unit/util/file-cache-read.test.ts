import fs from "fs";
import os from "os";
import path from "path";
import {FileCache} from "../../../src/util/FileCache";

test("a real truncated backing file cannot return an apparently complete cache record", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "file-cache-read-"));
    const cache = FileCache.create(directory);
    try {
        const data = Buffer.from("complete cached payload");
        const record = cache.writeSync(data);
        expect(cache.readSync(record.id)).toEqual(data);
        fs.truncateSync(cache.filePath, 2);
        expect(() => cache.readSync(record.id)).toThrow();
        expect(cache.readSync(record.id + 100)).toBeUndefined();
        cache.deleteSync();
        expect(cache.readSync(record.id)).toBeUndefined();
    } finally {
        cache.deleteSync();
        fs.rmSync(directory, {recursive: true, force: true});
    }
});

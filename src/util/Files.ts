import File from "./File";
import fs from 'fs';

export type AtomicFileValue = {file: File, data?: Buffer | string, mode?: number};

class Files {
    private static atomicSequence = 0;

    static captureFiles(files: File[]): AtomicFileValue[] {
        return files.map(file => fs.existsSync(file.toString())
            ? {file, data: fs.readFileSync(file.toString()), mode: fs.statSync(file.toString()).mode & 0o777}
            : {file});
    }

    private static atomicTemp(file: File): File {
        return new File(file.getParentFile().toString(), `.${file.getName()}.${process.pid}.${Date.now()}.${this.atomicSequence++}.tmp`);
    }

    static writeAtomicBatchSync(changes: AtomicFileValue[]): void {
        const unique = [...new Map(changes.map(change => [change.file.toString(), change])).values()];
        const before = this.captureFiles(unique.map(change => change.file));
        const staged = unique.map(change => ({change, temp: change.data === undefined ? undefined : this.atomicTemp(change.file)}));
        const published: number[] = [];
        let failure: unknown;
        try {
            for(const {change, temp} of staged) {
                if(!temp) continue;
                const directory = change.file.getParentFile();
                if(!directory.isDirectory()) directory.mkdirs();
                fs.writeFileSync(temp.toString(), change.data!, {mode: change.mode ?? 0o600});
            }
            for(let index = 0; index < staged.length; index++) {
                const {change, temp} = staged[index];
                if(temp) fs.renameSync(temp.toString(), change.file.toString());
                else if(fs.existsSync(change.file.toString())) fs.unlinkSync(change.file.toString());
                published.push(index);
            }
        } catch(error) {
            failure = error;
            const recoveryFailedPaths: string[] = [];
            for(const index of published.reverse()) {
                const previous = before[index];
                try {
                    if(previous.data === undefined) {
                        if(fs.existsSync(previous.file.toString())) fs.unlinkSync(previous.file.toString());
                    } else {
                        this.writeAtomicSync(previous.file, previous.data);
                        if(previous.mode !== undefined) fs.chmodSync(previous.file.toString(), previous.mode);
                    }
                } catch { recoveryFailedPaths.push(previous.file.toString()); }
            }
            Object.assign(error as object, {recoveryFailedPaths});
            throw error;
        } finally {
            const cleanupFailedPaths: string[] = [];
            let cleanupError: unknown;
            for(const {temp} of staged) {
                try {
                    if(temp && fs.existsSync(temp.toString())) fs.unlinkSync(temp.toString());
                } catch(error) { cleanupFailedPaths.push(temp!.toString()); cleanupError ??= error; }
            }
            if(cleanupFailedPaths.length > 0) {
                if(failure) Object.assign(failure as object, {cleanupFailedPaths});
                else throw cleanupError;
            }
        }
    }

    private static stringify(data: any): string {
        if(typeof(data) == 'object') {
            return JSON.stringify(data);
        }
        if(typeof(data) == 'string') {
            return data;
        }
        return data + '';
    }

    /**
     *
     * @param {File} file

     * @returns {Promise<String>}
     */
    static async toString(file : File) : Promise<string | undefined> {
        if(!file.canRead()) return undefined
        return new Promise((rev, rej) => {
            fs.readFile(file.toString(),{encoding: 'utf-8'}, (err: any, data: any) => {
                if(err) rej(err);
                else rev(data);
            });
        });
    }

    static async read(file : File) : Promise<Buffer | undefined> {
        if(!file.canRead()) return undefined
        return new Promise((rev, rej) => {
            fs.readFile(file.toString(),{encoding: 'binary'}, (err: any, data: any) => {
                if(err) rej(err);
                else rev(data);
            });
        });
    }

    static toStringSync(file : File) {
        if(!file.canRead()) return;
        return fs.readFileSync(file.toString(),{encoding: 'utf-8'});
    }



    static async write(file: File,data: any): Promise<void> {
        const strData = Files.stringify(data);
        return new Promise((rev, rej) => {
            fs.writeFile(file.toString(), strData,{encoding: 'utf-8'}, (err) => {
                if(err) rej(err);
                else rev();

            });
        });
    }

    static writeSync(file: File,data: any) {
        const strData = Files.stringify(data);
        let dir = file.getParentFile();
        if(!dir.isDirectory()) {
            dir.mkdirs();
        }

        fs.writeFileSync(file.toString(), strData,{encoding: 'utf-8'});
    }

    static async writeAtomic(file: File, data: any): Promise<void> {
        const dir = file.getParentFile();
        if(!dir.isDirectory()) {
            dir.mkdirs();
        }
        const tempFile = new File(dir.toString(), `.${file.getName()}.${process.pid}.${Date.now()}.tmp`);
        const strData = Files.stringify(data);
        await new Promise<void>((resolve, reject) => {
            fs.writeFile(tempFile.toString(), strData, {encoding: 'utf-8'}, (err) => {
                if(err) {
                    reject(err);
                    return;
                }
                resolve();
            });
        });
        await new Promise<void>((resolve, reject) => {
            fs.rename(tempFile.toString(), file.toString(), (err) => {
                if(err) {
                    reject(err);
                    return;
                }
                resolve();
            });
        });
    }

    static writeAtomicSync(file: File, data: any): void {
        const dir = file.getParentFile();
        if(!dir.isDirectory()) {
            dir.mkdirs();
        }
        const tempPath = this.atomicTemp(file).toString();
        const strData = Buffer.isBuffer(data) ? data : Files.stringify(data);
        fs.writeFileSync(tempPath, strData, {encoding: 'utf-8'});
        fs.renameSync(tempPath, file.toString());
    }


    public static deleteAll(file: File) {
        if(file.isFile()) {
            file.delete();
        } else if(file.isDirectory()) {
            let files = file.listFiles();
            for(let f of files) {
                this.deleteAll(f);
                f.delete();
            }
        }

    }

}


export default Files;

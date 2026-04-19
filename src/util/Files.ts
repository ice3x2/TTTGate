import File from "./File";
import fs from 'fs';
import Path from "path";

class Files {

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
        const tempPath = Path.join(dir.toString(), `.${file.getName()}.${process.pid}.${Date.now()}.tmp`);
        const strData = Files.stringify(data);
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

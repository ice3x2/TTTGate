import * as fs from 'fs';
import archiver from 'archiver';
import  File  from './File';

export class Zip {
    private constructor() {

    }
    public static async zipFiles(filePaths: string[], outputZipPath: string): Promise<void> {
        return new Promise((resolve, reject) => {
            const output = fs.createWriteStream(outputZipPath);
            const archive = archiver('zip', {
                zlib: { level: 9 } // Sets the compression level.
            });

            output.on('close', () => {
                console.log(`${archive.pointer()} total bytes`);
                console.log('Archiver has been finalized and the output file descriptor has closed.');
                resolve();
            });

            archive.on('warning', (err: any) => {
                if (err.code === 'ENOENT') {
                    console.warn(err);
                } else {
                    reject(err);
                }
            });

            archive.on('error', (err: any) => {
                reject(err);
            });

            archive.pipe(output);

            filePaths.forEach(filePath => {
                let file = new File(filePath);
                archive.file(filePath, { name: file.getName() });
            });

            archive.finalize();
        });
    }
}
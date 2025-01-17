/// <reference types="node" />
import File from "./File";
declare class Files {
    /**
     *
     * @param {File} file

     * @returns {Promise<String>}
     */
    static toString(file: File): Promise<string | undefined>;
    static read(file: File): Promise<Buffer | undefined>;
    static toStringSync(file: File): string | undefined;
    static write(file: File, data: any): Promise<void>;
    static writeSync(file: File, data: any): void;
    static deleteAll(file: File): void;
}
export default Files;

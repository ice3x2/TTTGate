"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const fs_1 = __importDefault(require("fs"));
class Files {
    /**
     *
     * @param {File} file

     * @returns {Promise<String>}
     */
    static async toString(file) {
        if (!file.canRead())
            return undefined;
        return new Promise((rev, rej) => {
            fs_1.default.readFile(file.toString(), { encoding: 'utf-8' }, (err, data) => {
                if (err)
                    rej(err);
                else
                    rev(data);
            });
        });
    }
    static async read(file) {
        if (!file.canRead())
            return undefined;
        return new Promise((rev, rej) => {
            fs_1.default.readFile(file.toString(), { encoding: 'binary' }, (err, data) => {
                if (err)
                    rej(err);
                else
                    rev(data);
            });
        });
    }
    static toStringSync(file) {
        if (!file.canRead())
            return;
        return fs_1.default.readFileSync(file.toString(), { encoding: 'utf-8' });
    }
    static async write(file, data) {
        let strData = '';
        if (typeof (data) == 'object') {
            strData = JSON.stringify(strData);
        }
        else if (typeof (data) == 'string') {
            strData = data;
        }
        else
            strData = data + '';
        return new Promise((rev, rej) => {
            fs_1.default.writeFile(file.toString(), strData, { encoding: 'utf-8' }, (err) => {
                if (err)
                    rej(err);
                else
                    rev();
            });
        });
    }
    static writeSync(file, data) {
        let strData = '';
        if (typeof (data) == 'object') {
            strData = JSON.stringify(strData);
        }
        else if (typeof (data) == 'string') {
            strData = data;
        }
        else
            strData = data + '';
        let dir = file.getParentFile();
        if (!dir.isDirectory()) {
            dir.mkdirs();
        }
        fs_1.default.writeFileSync(file.toString(), strData, { encoding: 'utf-8' });
    }
    static deleteAll(file) {
        if (file.isFile()) {
            file.delete();
        }
        else if (file.isDirectory()) {
            let files = file.listFiles();
            for (let f of files) {
                this.deleteAll(f);
                f.delete();
            }
        }
    }
}
exports.default = Files;

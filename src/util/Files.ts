import File from "./File";
import fs from 'fs';

class Files {

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

    static toStringSync(file : File) {
        if(!file.canRead()) return;
        return fs.readFileSync(file.toString(),{encoding: 'utf-8'});
    }


    /**
     *
     * @param {File} file
     * @param {any} data
     * @param {string | undefined} encoding
     * @returns
     */
    static async write(file: File,data: any): Promise<void> {

        let strData = '';
        if(typeof(data) == 'object') {
            strData = JSON.stringify(strData);
        }
        else if(typeof(data) == 'string') {
            strData = data;
        }
        else strData = data + '';
        return new Promise((rev, rej) => {
            fs.writeFile(file.toString(), strData,{encoding: 'utf-8'}, (err) => {
                if(err) rej(err);
                else rev();

            });
        });
    }

    static writeSync(file: File,data: any) {
        let strData = '';
        if(typeof(data) == 'object') {
            strData = JSON.stringify(strData);
        }
        else if(typeof(data) == 'string') {
            strData = data;
        }
        else strData = data + '';
        fs.writeFileSync(file.toString(), strData,{encoding: 'utf-8'});
    }


}


export default Files;
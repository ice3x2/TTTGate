
let fs = require('fs');
let Path = require('path');

class File {

    private _path : string  = "";

    /**
     * @param paths
     */
    public constructor(...paths : string[] ) {

        if(paths.length > 0) {
            this._path = Path.join(this._path, ...paths);
        } else {
            this._path = Path.join(process.cwd());
        }

    }




    /**
     *
     * @returns {string} 파일 경로를 반환합니다.
     */
    public toString() : string{
        return this._path;

    }



    /**
     *
     * @returns {string} 파일 혹은 디렉토리명을 가져옵니다.
     */
    public getName() : string {
        return Path.basename(this._path);
    }


    /**
     * 파일 크기를 byte 단위로 가져옵니다.
     * @returns {number} 파일 크기
     */
    public length() : number {
        try {
            return fs.statSync(this._path).size;
        } catch {
            return 0;
        }
    }

    /**
     *  파일을 마지막으로 수정한 날짜를 가져옵니다.
     * @returns {number} UTC Ms 단위
     */
    public lastModified() : number {
        try {
            return fs.statSync(this._path).mtimeMs;
        } catch {
            return 0;
        }
    }

    /**
     * 파일을 생성한 날짜를 가져옵니다. 파일 시스템에서 지원해야 사용할 수 있습니다.
     * @returns {number} UTC Ms 단위
     */
    public creation() : number {
        try {
            return fs.statSync(this._path).birthtimeMs;
        } catch {
            return 0;
        }
    }

    /**
     * 마지막으로 파일에 접근한 날짜를 가져옵니다.
     * @returns {number} UTC Ms 단위
     */
    public lastAccess() : number {
        try {
            return Date.parse(fs.statSync(this._path).atimeMs);
        } catch {
            return 0;
        }
    }


    /**
     *
     * @returns {Array<string>} 하위 파일 경로를 배열로 가져온다.
     */
    public list() : Array<string> {
        if(this.isFile()) {
            return [];
        }
        let list = fs.readdirSync(this._path);
        for(let i = 0; i < list.length; ++i) {
            list[i] = Path.join(this._path, list[i]);
        }
        return list;
    }
    /**
     * 파일 또는 빈 디렉토리를 삭제합니다.
     * @returns {boolean} 삭제 성공할 경우 true,
     */
    public delete() : boolean {
        try {
            let stat = fs.statSync(this._path);
            if(stat.isDirectory()) {
                fs.rmdirSync(this._path);
                return true;
            } else if(stat.isFile()) {
                fs.rmSync(this._path);
                return true;
            }
            return false;
        } catch(e) {
            return false;
        }
    }

    /**
     * 파일 혹은 디렉토리를 모두 삭제합니다. 하위경로를 모두 포함하여 제거합니다.
     * @returns {boolean} 성공시 true, 경로가 존재하지 않거나 실패시 false
     */
    public deleteAll() : boolean{
        try {
            let stat = fs.statSync(this._path);
            if(stat.isFile() || stat.isDirectory()) {
                fs.rmSync(this._path, {recursive: true, force: true});
                return true;
            }
            return false;
        } catch(e) {
            return false;
        }
    }


    /**
     * 빈 파일을 새로 생성합니다.
     * @returns {boolean} 생성 실패시 false 반환.
     */
    public createNewFile() : boolean {
        if(this.exists()) return false;
        try {
            fs.writeFileSync(this._path, '', {});
        } catch(e) {
            return false;
        }
        return true;
    }

    /**
     * @returns {Array<File>} 하위 파일의 File 객체를 배열로 가져온다.
     */
    public listFiles() : Array<File> {
        let list = this.list();
        let fileList = [];
        for(let i = 0; i < list.length; ++i) {
            fileList.push(new File(list[i]));
        }
        return fileList;
    }


    /**
     *
     * @returns {boolean} 존재하는 경로면  true,  그렇지 않으면 false
     */
    public exists() :boolean {
        try {
            let stat = fs.statSync(this._path);
            return stat.isDirectory() || stat.isFile();
        } catch {
            return false;
        }
    }

    /**
     * 파일을 읽을 수 있는 상태인지 알아봅니다. 경로가 존재하거나 권한이 있는지 등등..
     * @returns {boolean} 읽을 수 있다면 true, 없다면 false
     */
    public canRead() : boolean {
        try {
            fs.accessSync(this._path, fs.constants.R_OK);
            return true;
        } catch {
            return false;
        }
    }

    /**
     * 파일을 쓸 수 있는 상태인지 알아봅니다. 경로가 존재하거나 권한이 있는지 등등..
     * @returns {boolean} 쓸 수 있다면 true, 없다면 false
     */
    public canWrite() : boolean {
        try {
            fs.accessSync(this._path, fs.constants.W_OK);
            return true;
        } catch {
            return false;
        }
    }

    /**
     * 부모 디렉토리 경로를 가져옵니다.
     * @returns {string} 부모 디렉토리 경로
     */
    public getParent() : string{
        return Path.resolve(this._path, '..');
    }


    /**
     * 부모 디렉토리 파일 객체를 가져옵니다.
     * @returns {File} 부모 디렉토리 파일 객체
     */
    public getParentFile() : File {
        return new File(Path.resolve(this._path, '..'));
    }

    /**
     * 디렉토리를 생성합니다. 부모 경로를 포함하지 않습니다.
     * @returns {boolean} 이미 존재하는 경로 또는 부모 경로가 존재하지 않을 때, 기타 이유로 디렉토리 생성 실패시 false
     */
    public mkdir() : boolean {
        if(this.exists()) return false;
        try {
            fs.mkdirSync(this._path);
            return this.isDirectory();
        } catch {
            return false;
        }
    }

    /**
     * 디렉토리를 생성합니다. 부모 경로를 포함합니다.
     * @returns {boolean} 이미 존재하는 경로 또는 디렉토리 생성 실패시 false
     */
    public mkdirs() : boolean{
        if(this.exists()) return false;
        try {
            fs.mkdirSync(this._path, {recursive: true});
            return this.isDirectory();
        } catch {
            return false;
        }
    }


    /**
     * 디렉토리인지 확인합니다. 존재하지 않는 경로거나 파일이면  false 를 반환합니다.
     * @returns  {boolean} 디렉토리라면 true, 경로가 올바르지 않거나 파일이라면 false
     */
    public isDirectory() : boolean {
        try {
            return fs.statSync(this._path).isDirectory();
        } catch {
            return false;
        }
        return true;
    }

    /**
     * 파인일지 확인합니다. 존재하지 않는 경로거나 디렉토리면 false 를 반환합니다.
     * @returns  {boolean} 파일이라면 true, 파일이 아니라면 false
     */
    public isFile() : boolean{
        try {
            return fs.statSync(this._path).isFile();
        } catch {
            return false;
        }
    }

    /**
     * 파일의 경로로 변경합니다.
     * @param {string | File} path
     * @returns {boolean} 경로 변경이 성공하면 true, 실패하면 false 를 반환합니다.
     */
    public rename(path : string | File) : boolean{
        let currentPath = this._path;
        let objFile = null;
        if(typeof(path) == 'string')  {
            objFile = new File(path);
        } else if(path instanceof File) {
            objFile = path;
        } else {
            return false;
        }

        let tmp = false;
        let tmpPath = currentPath + '.tmp' + Date.now();
        if(objFile._path.indexOf(currentPath) == 0) {
            try {
                fs.renameSync(currentPath, tmpPath);
                tmp = true;
            } catch(e) {
                return false;
            }
        }

        // 이미 존재하는 경로인경우 이동 실패.
        if(objFile.exists()) {
            if(tmp == true) {
                try {
                    fs.renameSync(tmpPath, currentPath);
                } catch {}
            }
            return false;
        }
        let parentFile = objFile.getParentFile();

        // 부모 경로가 존재하지 않고, 생성도 되지 않을 때 실패.
        if(!parentFile.exists() && !parentFile.mkdirs()) {
            if(tmp == true) {
                try {
                    fs.renameSync(tmpPath, currentPath);
                } catch {}
            }
            return false;
        }
        if(tmp == true) {
            currentPath = tmpPath;
        }


        try {
            fs.renameSync(currentPath, objFile._path);
            this._path = objFile.toString();
            return true;
        } catch(e) {
            if(tmp) {
                try {
                    fs.renameSync(tmpPath, objFile._path);
                } catch {}
            }
            console.log(e);
            return false;
        }
    }

}



//module.exports = File;

export default File;

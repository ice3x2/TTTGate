declare class File {
    private _path;
    /**
     * @param paths
     */
    constructor(...paths: string[]);
    /**
     *
     * @returns {string} 파일 경로를 반환합니다.
     */
    toString(): string;
    /**
     *
     * @returns {string} 파일 혹은 디렉토리명을 가져옵니다.
     */
    getName(): string;
    /**
     * 파일 크기를 byte 단위로 가져옵니다.
     * @returns {number} 파일 크기
     */
    length(): number;
    /**
     *  파일을 마지막으로 수정한 날짜를 가져옵니다.
     * @returns {number} UTC Ms 단위
     */
    lastModified(): number;
    /**
     * 파일을 생성한 날짜를 가져옵니다. 파일 시스템에서 지원해야 사용할 수 있습니다.
     * @returns {number} UTC Ms 단위
     */
    creation(): number;
    /**
     * 마지막으로 파일에 접근한 날짜를 가져옵니다.
     * @returns {number} UTC Ms 단위
     */
    lastAccess(): number;
    /**
     *
     * @returns {Array<string>} 하위 파일 경로를 배열로 가져온다.
     */
    list(): Array<string>;
    /**
     * 파일 또는 빈 디렉토리를 삭제합니다.
     * @returns {boolean} 삭제 성공할 경우 true,
     */
    delete(): boolean;
    /**
     * 파일 혹은 디렉토리를 모두 삭제합니다. 하위경로를 모두 포함하여 제거합니다.
     * @returns {boolean} 성공시 true, 경로가 존재하지 않거나 실패시 false
     */
    deleteAll(): boolean;
    /**
     * 빈 파일을 새로 생성합니다.
     * @returns {boolean} 생성 실패시 false 반환.
     */
    createNewFile(): boolean;
    /**
     * @returns {Array<File>} 하위 파일의 File 객체를 배열로 가져온다.
     */
    listFiles(): Array<File>;
    /**
     *
     * @returns {boolean} 존재하는 경로면  true,  그렇지 않으면 false
     */
    exists(): boolean;
    /**
     * 파일을 읽을 수 있는 상태인지 알아봅니다. 경로가 존재하거나 권한이 있는지 등등..
     * @returns {boolean} 읽을 수 있다면 true, 없다면 false
     */
    canRead(): boolean;
    /**
     * 파일을 쓸 수 있는 상태인지 알아봅니다. 경로가 존재하거나 권한이 있는지 등등..
     * @returns {boolean} 쓸 수 있다면 true, 없다면 false
     */
    canWrite(): boolean;
    /**
     * 부모 디렉토리 경로를 가져옵니다.
     * @returns {string} 부모 디렉토리 경로
     */
    getParent(): string;
    /**
     * 부모 디렉토리 파일 객체를 가져옵니다.
     * @returns {File} 부모 디렉토리 파일 객체
     */
    getParentFile(): File;
    /**
     * 디렉토리를 생성합니다. 부모 경로를 포함하지 않습니다.
     * @returns {boolean} 이미 존재하는 경로 또는 부모 경로가 존재하지 않을 때, 기타 이유로 디렉토리 생성 실패시 false
     */
    mkdir(): boolean;
    /**
     * 디렉토리를 생성합니다. 부모 경로를 포함합니다.
     * @returns {boolean} 이미 존재하는 경로 또는 디렉토리 생성 실패시 false
     */
    mkdirs(): boolean;
    /**
     * 디렉토리인지 확인합니다. 존재하지 않는 경로거나 파일이면  false 를 반환합니다.
     * @returns  {boolean} 디렉토리라면 true, 경로가 올바르지 않거나 파일이라면 false
     */
    isDirectory(): boolean;
    /**
     * 파인일지 확인합니다. 존재하지 않는 경로거나 디렉토리면 false 를 반환합니다.
     * @returns  {boolean} 파일이라면 true, 파일이 아니라면 false
     */
    isFile(): boolean;
    /**
     * 파일의 경로로 변경합니다.
     * @param {string | File} path
     * @returns {boolean} 경로 변경이 성공하면 true, 실패하면 false 를 반환합니다.
     */
    rename(path: string | File): boolean;
}
export default File;

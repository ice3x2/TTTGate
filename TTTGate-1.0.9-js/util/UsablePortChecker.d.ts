declare class UsablePortChecker {
    private constructor();
    static check(port: number): Promise<boolean>;
    static checkPorts(ports: Array<number>): Promise<Array<number>>;
    static findUsablePort(startPort: number, endPort: number): Promise<number>;
    static findUsablePorts(startPort: number, endPort: number, count?: number): Promise<Array<number>>;
    static findUsedPorts(startPort: number, endPort: number): Promise<Array<number>>;
}
export default UsablePortChecker;

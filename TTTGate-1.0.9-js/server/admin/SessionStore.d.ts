declare class SessionStore {
    private static _instance;
    private _sessions;
    private _key;
    private constructor();
    static get instance(): SessionStore;
    private loadKey;
    isEmptyKey(): Promise<boolean>;
    newSession(): Promise<string>;
    removeSession(sessionKey: string): Promise<void>;
    sweepSession(): void;
    isSessionValid(sessionKeyList: Array<string>): Promise<boolean>;
    login(key: string): Promise<boolean>;
    private hashPassword;
}
export default SessionStore;

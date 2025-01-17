import { ServerOption, TunnelingOption } from "../types/TunnelingOption";
interface ServerOptionUpdateCallback {
    (serverOption: ServerOption): void;
}
declare class ServerOptionStore {
    private static _instance;
    private readonly _configFile;
    private _serverOption;
    private _serverOptionUpdateCallback?;
    get serverOption(): ServerOption;
    set onServerOptionUpdateCallback(callback: ServerOptionUpdateCallback | undefined);
    updateServerOption(serverOption: ServerOption): boolean;
    removeTunnelingOption(forwardPort: number): boolean;
    updateTunnelingOption(tunnelingOption: TunnelingOption): boolean;
    getTunnelingOptions(): Array<TunnelingOption>;
    getTunnelingOption(forwardPort: number): TunnelingOption | undefined;
    static get instance(): ServerOptionStore;
    constructor();
    save(): void;
    reset(): void;
    private load;
    verificationServerOption(option: ServerOption): {
        success: boolean;
        message: string;
        serverOption?: ServerOption;
    };
    verificationTunnelingOption(option: TunnelingOption): {
        success: boolean;
        forwardPort: number;
        message: string;
    };
    private normalizationOfHttpOption;
    private makeDefaultOption;
}
export default ServerOptionStore;

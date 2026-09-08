import Environment from "../Environment";
import {CertificationStore} from "../server/CertificationStore";
import ServerOptionStore from "../server/ServerOptionStore";
import {SocketHandler} from "../util/SocketHandler";
import LoggerFactory from "../util/logger/LoggerFactory";

const AppCompositionRoot = {
    configureLogger(): void {
        const config = LoggerFactory.cloneConfig();
        config.logFileDir = Environment.path.logDir;
        config.appendWriteConfig({name: "server", console: true, history: 2});
        config.appendWriteConfig({name: "client", console: true});
        config.appendWriteConfig({name: "boot", console: true});
        config.appendWriteConfig({name: "socket", console: true});
        LoggerFactory.updateConfig(config);
    },
    useServerCacheDir(): void {
        SocketHandler.fileCacheDirPath = Environment.path.serverCacheDir;
    },
    useClientCacheDir(): void {
        SocketHandler.fileCacheDirPath = Environment.path.clientCacheDir;
    },
    applyGlobalMemLimitMiB(limitMiB: number = 128): void {
        SocketHandler.GlobalMemCacheLimit = limitMiB * 1024 * 1024;
    },
    serverStores(): {serverOptionStore: ServerOptionStore, certStore: CertificationStore} {
        return {
            serverOptionStore: ServerOptionStore.instance,
            certStore: CertificationStore.instance
        };
    }
};

export default AppCompositionRoot;

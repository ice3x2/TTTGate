import {SysInfo, SysMonitor} from "./SysMonitor";

type SystemInfoProvider = {
    sysInfo(): Promise<SysInfo>;
}

const DefaultSystemInfoProvider: SystemInfoProvider = {
    async sysInfo(): Promise<SysInfo> {
        return await SysMonitor.instance.sysInfo();
    }
};

let activeSystemInfoProvider: SystemInfoProvider = DefaultSystemInfoProvider;

const SystemInfoProviderRegistry = {
    current(): SystemInfoProvider {
        return activeSystemInfoProvider;
    },
    configure(provider: SystemInfoProvider): void {
        activeSystemInfoProvider = provider;
    },
    reset(): void {
        activeSystemInfoProvider = DefaultSystemInfoProvider;
    }
};

export { DefaultSystemInfoProvider, SystemInfoProvider, SystemInfoProviderRegistry };

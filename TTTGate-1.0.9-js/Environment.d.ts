declare const Environment: {
    path: {
        logDir: string;
        configDir: string;
        serverCacheDir: string;
        clientCacheDir: string;
        certDir: string;
        adminCertDir: string;
        externalCertDir: string;
        webDir: string;
        binDir: string;
    };
    devMode: boolean;
    version: {
        build: string;
        name: string;
    };
};
export default Environment;

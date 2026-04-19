import * as Path from "path";
import fs from "fs";


const DEV_MODE = process.argv.find((arg) => arg == '-dev') != undefined;
const DEFAULT_ROOT_DIR = (process.argv[0].includes('node') || process.argv[0].includes('npm')) ? process.cwd() : Path.join(process.argv[DEV_MODE ? 1 : 0], '..', '..');
const DEFAULT_BUILD_ID = process.env.TTTGATE_BUILD?.trim() || '20250117';

const makePaths = (rootDir: string) => {
    return {
        logDir : Path.join(rootDir, 'logs'),
        configDir : Path.join(rootDir, 'config'),
        //cacheDir : Path.join(ROOT_DIR, 'cache'),
        serverCacheDir : Path.join(rootDir, 'cache','server'),
        clientCacheDir : Path.join(rootDir, 'cache','client'),
        certDir : Path.join(rootDir,'cert'),
        adminCertDir : Path.join(rootDir,'cert', 'admin'),
        externalCertDir : Path.join(rootDir,'cert', 'external'),
        webDir : Path.join(rootDir,'web'),
        binDir: !DEV_MODE ? Path.join(rootDir,'bin') :Path.join(rootDir),
    };
};

const readPackageVersion = (): string => {
    const candidates = [
        Path.join(__dirname, "package.json"),
        Path.join(__dirname, "..", "package.json"),
        Path.join(__dirname, "..", "..", "package.json"),
        Path.join(process.cwd(), "package.json")
    ];

    for(const candidate of candidates) {
        try {
            const raw = fs.readFileSync(candidate, {encoding: "utf-8"});
            const parsed = JSON.parse(raw) as {version?: string};
            if(parsed.version && parsed.version.trim().length > 0) {
                return parsed.version.trim();
            }
        } catch {}
    }

    return "0.0.0-dev";
};


const Environment = {
    rootDir: DEFAULT_ROOT_DIR,

    path : makePaths(DEFAULT_ROOT_DIR),
    devMode : DEV_MODE,
    version : {
        build: DEFAULT_BUILD_ID,
        name: readPackageVersion()
    },
    configure: ({rootDir}: {rootDir?: string}) => {
        if(rootDir && rootDir.length > 0) {
            Environment.rootDir = rootDir;
            Environment.path = makePaths(rootDir);
        }
    },
    reset: () => {
        Environment.rootDir = DEFAULT_ROOT_DIR;
        Environment.path = makePaths(DEFAULT_ROOT_DIR);
    }
}

export default Environment;

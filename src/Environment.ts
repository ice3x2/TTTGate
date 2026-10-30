import * as Path from "path";
import fs from "fs";


const DEV_MODE = process.argv.find((arg) => arg == '-dev') != undefined;
const DEFAULT_ROOT_DIR = (process.argv[0].includes('node') || process.argv[0].includes('npm')) ? process.cwd() : Path.join(process.argv[DEV_MODE ? 1 : 0], '..', '..');
/** deploy.js 가 빌드할 때 빌드 날짜(UTC, YYYYMMDD)를 적는 파일. 컴파일된 이 모듈 옆에 놓인다(#290). */
const BUILD_INFO_FILE = 'build-info.js';

/**
 * 빌드 날짜. 실행할 때 준 TTTGATE_BUILD 가 먼저이고, 없으면 릴리스 빌드가 적은 값, 그것도 없으면 'dev' 다(#290).
 * 예전에는 고정값을 써서 모든 배포물이 같은 날짜를 보고했다.
 */
export const resolveBuildId = (env: NodeJS.ProcessEnv, directory: string): string => {
    const fromEnv = env.TTTGATE_BUILD?.trim();
    if(fromEnv) return fromEnv;
    const file = Path.join(directory, BUILD_INFO_FILE);
    if(fs.existsSync(file)) {
        const stamped = (require(file) as {build?: unknown}).build;
        if(typeof stamped === 'string' && stamped.length > 0) return stamped;
    }
    return 'dev';
};

const DEFAULT_BUILD_ID = resolveBuildId(process.env, __dirname);

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

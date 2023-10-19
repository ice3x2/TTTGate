import * as Path from "path";


const DEV_MODE = process.argv.find((arg) => arg == '-dev') != undefined;
const ROOT_DIR = Path.join(process.argv[DEV_MODE ? 1 : 0],'..' ,'..');

const Environment = {

    path : {
        logDir : Path.join(ROOT_DIR, 'logs'),
        configDir : Path.join(ROOT_DIR, 'config'),
        //cacheDir : Path.join(ROOT_DIR, 'cache'),
        serverCacheDir : Path.join(ROOT_DIR, 'cache','server'),
        clientCacheDir : Path.join(ROOT_DIR, 'cache','client'),
        certDir : Path.join(ROOT_DIR,'cert'),
        adminCertDir : Path.join(ROOT_DIR,'cert', 'admin'),
        externalCertDir : Path.join(ROOT_DIR,'cert', 'external'),
        webDir : Path.join(ROOT_DIR,'web'),
        binDir: !DEV_MODE ? Path.join(ROOT_DIR,'bin') :Path.join(ROOT_DIR),
    },
    devMode : DEV_MODE,
    version : {
        build: '20231019',
        name: '1.0.5b'
    }
}

export default Environment;
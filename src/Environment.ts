import * as Path from "path";


const DEV_MODE = process.argv.find((arg) => arg == '-dev') != undefined;

//console.log(process.cwd())
const Environment = {

    path : {
        logDir : Path.join(process.cwd(),DEV_MODE ? '.' : '..', 'logs'),
        configDir : Path.join(process.cwd(),DEV_MODE ? '.' : '..', 'config'),
        //cacheDir : Path.join(process.cwd(),DEV_MODE ? '.' : '..', 'cache'),
        serverCacheDir : Path.join(process.cwd(),DEV_MODE ? '.' : '..', 'cache','server'),
        clientCacheDir : Path.join(process.cwd(),DEV_MODE ? '.' : '..', 'cache','client'),
        certDir : Path.join(process.cwd(),DEV_MODE ? '.' : '..','cert'),
        adminCertDir : Path.join(process.cwd(),DEV_MODE ? '.' : '..','cert', 'admin'),
        externalCertDir : Path.join(process.cwd(),DEV_MODE ? '.' : '..','cert', 'external'),
        webDir : Path.join(process.cwd(),DEV_MODE ? '.' : '..','web'),
    }
}

export default Environment;
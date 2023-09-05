import * as Path from "path";


const DEV_MODE = true;

//console.log(process.cwd())
const Environment = {

    path : {
        logDir : Path.join(process.cwd(),DEV_MODE ? '.' : '..', 'logs'),
        configDir : Path.join(process.cwd(),DEV_MODE ? '.' : '..', 'config'),
        adminCertDir : Path.join(process.cwd(),DEV_MODE ? '.' : '..','cert', 'admin'),
        externalCertDir : Path.join(process.cwd(),DEV_MODE ? '.' : '..','cert', 'external'),
    }
}

export default Environment;
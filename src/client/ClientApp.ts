import {ClientOption, DEFAULT_KEY} from "../types/TunnelingOption";
import TunnelNames from "./TunnelNames";
import TTTClient from "./TTTClient";
import File from "../util/File";
import Environment from "../Environment";
import YAML from "yaml";
import Files from "../util/Files";
import CLI from "../util/CLI";
import LoggerFactory  from "../util/logger/LoggerFactory";
import AppCompositionRoot from "../bootstrap/AppCompositionRoot";
import {ClockRngProvider} from "../util/ClockRng";
import {redactSecrets} from "../util/SecretRedactor";
const logger = LoggerFactory.getLogger('client', 'ClientApp');

const CLIENT_OPTION_FILE_NAME = "client.yaml";



let _printClientOptions = (clientOption: ClientOption) : void => {
    let options = '';
    let obj = redactSecrets(clientOption) as any;
    for(let key in obj) {
        options += `\t\t\t  -${key}: ${obj[key]} \n`;
    }
    logger.info(`Client options: \n${options}`);
}


let _loadClientOptionFromFile = () : ClientOption | undefined => {

    let file = new File(Environment.path.configDir, CLIENT_OPTION_FILE_NAME);
    if(file.canRead()) {
        let yamlString = Files.toStringSync(file);
        if(yamlString == undefined || yamlString.length == 0) return undefined;
        let clientOption = YAML.parse(yamlString);
        return clientOption as ClientOption;
    }
    return undefined;
}



let normalizationClientOption = (clientOption: ClientOption) : ClientOption => {
    if(clientOption.key == undefined) {
        clientOption.key = DEFAULT_KEY;
    }
    if(clientOption.host == undefined) {
        clientOption.host = "localhost";
    }
    if(clientOption.port == undefined) {
        clientOption.port = 9126;
    }
    if(clientOption.tls == undefined) {
        clientOption.tls = false;
    }
    if(clientOption.name == undefined) {
        clientOption.name = TunnelNames[Math.floor(ClockRngProvider.current().random() * TunnelNames.length)];
    }
    return clientOption;
}

let _loadClientOption = (cliOptions?: {[key: string]: string}) : ClientOption => {

    let clientOption : ClientOption = {
        key: DEFAULT_KEY,
        host: "localhost",
        port: 9126,
        tls: false,
        name: TunnelNames[Math.floor(ClockRngProvider.current().random() * TunnelNames.length)],
        allowLegacyFallback: false,
        allowInsecureTls: false,
        globalMemCacheLimit: 128,
        keepAlive: 0
    }
    let savedOption = _loadClientOptionFromFile();
    if(savedOption) {
        clientOption = normalizationClientOption(savedOption);
    }

    let argv = cliOptions ?? CLI.parseCommandLine().options;
    if(argv["key"]) {
        clientOption.key = argv["key"];
    }
    if(argv["addr"]) {
        let addr = argv["addr"];
        let addrSplit = addr.split(":");
        if(addrSplit.length == 2) {
            clientOption.host = addrSplit[0];
            clientOption.port = parseInt(addrSplit[1]);
            if(isNaN(clientOption.port)){
                throw new Error("port is not number.");
            } else if(clientOption.port <= 0 || clientOption.port > 65535) {
                throw new Error("port is out of range. (1 ~ 65535)");
            }
        } else {
            clientOption.host = addr;
        }
    }
    if(argv["keepAlive"]) {
        clientOption.keepAlive = Math.floor(parseInt(argv["keepAlive"]));
        if(isNaN(clientOption.keepAlive)){
            console.warn(`keepAlive '${argv["keepAlive"]}' is not number.`);
            clientOption.keepAlive = -1;
        }
        else if(clientOption.keepAlive < 0) {
            console.warn(`keepAlive is disabled. (keepAlive: ${clientOption.keepAlive})`);
            clientOption.keepAlive = -1;
        }
    }
    if(argv["tls"] != undefined && (argv["tls"] == "" || argv["tls"].toLowerCase() != "false")) {
        clientOption.tls = true;
    }
    if(argv["name"]) {
        clientOption.name = argv["name"];
    }
    if(argv["clientId"]) {
        clientOption.clientId = argv["clientId"];
    }
    if(argv["clientSecret"]) {
        clientOption.clientSecret = argv["clientSecret"];
    }
    if(argv["displayName"]) {
        clientOption.displayName = argv["displayName"];
    }
    if(argv["serverName"]) {
        clientOption.serverName = argv["serverName"];
    }
    if(argv["ca"]) {
        clientOption.ca = argv["ca"];
    }
    if(argv["cert"]) {
        clientOption.cert = argv["cert"];
    }
    if(argv["privateKey"]) {
        clientOption.privateKey = argv["privateKey"];
    }
    if(argv["allowLegacyFallback"] != undefined && (argv["allowLegacyFallback"] == "" || argv["allowLegacyFallback"].toLowerCase() != "false")) {
        clientOption.allowLegacyFallback = true;
    }
    if(argv["allowInsecureTls"] != undefined && (argv["allowInsecureTls"] == "" || argv["allowInsecureTls"].toLowerCase() != "false")) {
        clientOption.allowInsecureTls = true;
    }
    if(argv["bufferLimit"]) {
        clientOption.globalMemCacheLimit = Math.floor(parseInt(argv["bufferLimit"]));
        if(isNaN(clientOption.globalMemCacheLimit)){
            console.warn(`bufferLimit '${argv["bufferLimit"]}' is not number.`);
            clientOption.globalMemCacheLimit = 238;
        }
        else if(clientOption.globalMemCacheLimit < -1) {
            console.warn(`bufferLimit '${argv["bufferLimit"]}' is less than -1.`);
            clientOption.globalMemCacheLimit = -1;
        } else if(clientOption.globalMemCacheLimit > 1048576) {
            clientOption.globalMemCacheLimit = 1048576
        }
    }
    if(argv["save"] != undefined && (argv["save"] == "" || argv["save"].toLowerCase() != "false")) {
        let file = new File(Environment.path.configDir, CLIENT_OPTION_FILE_NAME);
        let yamlString = YAML.stringify(clientOption);
        Files.writeSync(file, yamlString);
    }
    _printClientOptions(clientOption);
    AppCompositionRoot.applyGlobalMemLimitMiB(clientOption.globalMemCacheLimit);
    return clientOption;
}


let ClientApp : { start(options?: {[key: string]: string}) : void} = {

    start(options?: {[key: string]: string}) {
        AppCompositionRoot.applyGlobalMemLimitMiB(128);
        let tttClient = TTTClient.create(_loadClientOption(options));

        tttClient.start();


    }
}


export default ClientApp;

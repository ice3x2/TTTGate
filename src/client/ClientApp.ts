import {ClientOption, DEFAULT_KEY} from "../option/TunnelingOption";
import TunnelNames from "./TunnelNames";
import TTTClient from "./TTTClient";
import {logger} from "../commons/Logger";
import File from "../util/File";
import Environment from "../Environment";
import YAML from "yaml";
import Files from "../util/Files";
import CLI from "../util/CLI";
import {SocketHandler} from "../util/SocketHandler";

const CLIENT_OPTION_FILE_NAME = "client.yaml";



let _printClientOptions = (clientOption: ClientOption) : void => {
    let options = '';
    let obj = clientOption as any;
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
        clientOption.name = TunnelNames[Math.floor(Math.random() * TunnelNames.length)];
    }
    return clientOption;
}

let _loadClientOption = () : ClientOption => {

    let clientOption : ClientOption = {
        key: DEFAULT_KEY,
        host: "localhost",
        port: 9126,
        tls: false,
        name: TunnelNames[Math.floor(Math.random() * TunnelNames.length)],
        globalMemCacheLimit: 512
    }
    let savedOption = _loadClientOptionFromFile();
    if(savedOption) {
        clientOption = normalizationClientOption(savedOption);
    }

    let argv = CLI.readSimpleOptions();
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
    if(argv["tls"] != undefined && (argv["tls"] == "" || argv["tls"].toLowerCase() != "false")) {
        clientOption.tls = true;
    }
    if(argv["name"]) {
        clientOption.name = argv["name"];
    }
    if(argv["bufferLimit"]) {
        clientOption.globalMemCacheLimit = Math.floor(parseInt(argv["bufferLimit"]));
        if(isNaN(clientOption.globalMemCacheLimit)){
            console.warn(`bufferLimit '${argv["bufferLimit"]}' is not number.`);
            clientOption.globalMemCacheLimit = 512;
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
    SocketHandler.GlobalMemCacheLimit = clientOption.globalMemCacheLimit * 1024 * 1024;
    return clientOption;
}


let ClientApp : { start() : void} = {

    start() {
        SocketHandler.DefaultCacheDirectory = Environment.path.clientCacheDir;
        SocketHandler.GlobalMemCacheLimit = 512 * 1024 * 1024;
        let tttClient = TTTClient.create(_loadClientOption());
        tttClient.start();
    }
}


export default ClientApp;



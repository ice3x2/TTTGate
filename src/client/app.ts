import ServerOptionStore from "../server/ServerOptionStore";
import {CertificationStore} from "../server/CertificationStore";
import ObjectUtil from "../util/ObjectUtil";
import {logger} from "../commons/Logger";
import {ClientOption, DEFAULT_KEY} from "../option/Options";
import TunnelNames from "./TunnelNames";
import TTTClient from "./TTTClient";



let _loadClientOption = () : ClientOption => {

    let clientOption : ClientOption = {
        key: DEFAULT_KEY,
        host: "localhost",
        port: 9126,
        tls: false,
        name: TunnelNames[Math.floor(Math.random() * TunnelNames.length)]
    }

    let argv = _loadArgv();
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
    if(argv["tls"] && argv["tls"].toLowerCase() == "true" ) {
        clientOption.tls = true;
    }
    if(argv["name"]) {
        clientOption.name = argv["name"];
    }

    return clientOption;
}

let _loadArgv = () : { [key: string]: string } => {

    let result : { [key: string]: string } = {};
    let items : Array<string> = process.argv;
    let currentKey : string = "";
    for(let item of items) {
        if(item.startsWith("-") && item.length > 1) {
            currentKey = item.replace(/^-/ig,"");
            if(currentKey == "tls") {
                result[currentKey] = "true";
            }
            else {
                result[currentKey] = "";
            }
        } else if(!item) {
        }
        else {
            if(result[currentKey] != undefined) {
                result[currentKey] = item;
                currentKey = "";
            }
        }
    }


    return result;
}


let tttClient = TTTClient.create(_loadClientOption());
tttClient.start();
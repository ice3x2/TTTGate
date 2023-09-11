import { type ServerOption, InvalidSession } from "./Types";
import type {TunnelingStatus, Options} from "./Options";


class ServerOptionCtrl {


    private static _instance : ServerOptionCtrl;
    private _severOptionHash : string = '';
    private _serverOption : ServerOption = {
        key: '',
        adminPort: 0,
        adminTls: false,
        port: 0,
        tls: false
    }
    private _tunnelingOptions : Array<Options> = [];

    private constructor() {

    }



    public static get instance() : ServerOptionCtrl {
        if(!ServerOptionCtrl._instance) {
            ServerOptionCtrl._instance = new ServerOptionCtrl();
        }
        return ServerOptionCtrl._instance;
    }

    public getCachedServerOption() : ServerOption {
        return this._serverOption;
    }

    public async getServerOption() : Promise<ServerOption> {
        let res = await fetch("/api/serverOption", {
            method: "GET",
            credentials: "same-origin"

        });
        let json = await res.json();
        if(!json || res.status == 401) {
            throw new InvalidSession();
        }
        this._serverOption = json['serverOption'];
        return this._serverOption;
    }


    public async getTunnelingOption() : Promise<Array<Options>> {
        let res = await fetch("/api/tunnelingOption", {
            method: "GET",
            credentials: "same-origin"
        });
        let json = await res.json();
        if(!json || res.status == 401) {
            throw new InvalidSession();
        }
        this._tunnelingOptions = json['tunnelingOptions'];
        return this._tunnelingOptions;
    }

    public async checkChangeServerOption(oldServerOptions: ServerOption, newServerOption: ServerOption) : Promise<boolean> {
        let oldHash = this._severOptionHash;
        const timeout = 120000;
        let startTick = new Date().getTime();
        return new Promise(async (resolve, reject) => {
            let interval = setInterval(async () => {
                let newHash = '';

                try {
                    newHash = await this.getServerOptionHash(newServerOption.adminTls ? 'https' : 'http', newServerOption.adminPort);
                } catch (err) {
                    if(startTick + timeout < new Date().getTime()) {
                        clearInterval(interval);
                        reject(err);
                    }
                    try {
                        newHash = await this.getServerOptionHash(oldServerOptions.adminTls ? 'https' : 'http', oldServerOptions.adminPort);
                    } catch (err2) {
                        newHash = '';
                        if(startTick + timeout < new Date().getTime()) {
                            clearInterval(interval);
                            reject(err);
                        }
                    }
                }
                if(newHash.length > 0) {
                    clearInterval(interval);
                    resolve(newHash != oldHash);
                }
            }, 1000);

        });
    }


    public async getServerOptionHash(protocol?: 'http' | 'https', port?: number | string) : Promise<string> {
        let host = window.location.hostname;
        let hostPort = window.location.port;
        if(!protocol) {
            protocol = window.location.protocol.replace(':','') as 'http' | 'https';
        }
        if(port) {
            hostPort = port.toString();
        }

        let res = await fetch(`${protocol}://${host}:${hostPort}/api/serverOptionHash`, {
            method: "GET",
            headers: {
                'Connection': 'close'
            }
        });
        let json = await res.json();
        if(!json || res.status == 401) {
            throw new InvalidSession();
        }
        let hash = json['hash'];
        if(!hash) {
            throw new Error('hash not found');
        }
        this._severOptionHash = hash;
        return hash;
    }


    public async updateServerOption(serverOption: ServerOption) : Promise<{success: boolean, message: string, updated: boolean, updates: object}> {
        let res = await fetch("/api/serverOption", {
            method: "POST",
            credentials: "same-origin",
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(serverOption)
        });
        let json = await res.json();
        if(!json || res.status == 401) {
            throw new InvalidSession();
        }
        return json;
    }

    public async updateTunnelingOption(tunnelingOption : Options) : Promise<{success: boolean, message: string}> {
        let res = await fetch("/api/tunnelingOption", {
            method: "POST",
            credentials: "same-origin",
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(tunnelingOption)
        });
        let json = await res.json();
        if(!json || res.status == 401) {
            throw new InvalidSession();
        }
        return json;
    }

    public async removeTunnelingOption(tunnelingOption : Options | {forwardPort: number}) : Promise<{success: boolean, message: string, forwardPort: number}> {
        let res = await fetch("/api/tunnelingOption", {
            method: "DELETE",
            credentials: "same-origin",
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(tunnelingOption)
        });
        let json = await res.json();
        if(!json || res.status == 401) {
            throw new InvalidSession();
        }
        return json;
    }


    public async loadTunnelingStatus() : Promise<{serverTime: number,statuses: Array<TunnelingStatus>}> {
        let res = await fetch("/api/externalServerStatuses", {
            method: "GET",
            credentials: "same-origin"
        });
        let json = await res.json();
        if(!json || res.status == 401) {
            throw new InvalidSession();
        }
        return {serverTime : json['serverTime'] as number, statuses:  json['statuses'] as Array<TunnelingStatus>};
    }

    public async activeExternalPortServer(active: boolean, port: number, timeout?: number) : Promise<{success: boolean, message: string}> {

        timeout = timeout ?? 0;
        let res = await fetch(`/api/tunneling/active/${port}`, {
            method: "POST",
            credentials: "same-origin",
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({active: active,timeout: timeout})
        });
        let json = await res.json();
        if(!json || res.status == 401) {
            throw new InvalidSession();
        }
        return json;
    }



    public static checkValidTunnelingOption(tunnelingOption: Options) : boolean {
        if(tunnelingOption.tls == undefined)
            return false;
        if(tunnelingOption.forwardPort == undefined || tunnelingOption.forwardPort <= 0 || tunnelingOption.forwardPort > 65535)
            return false;
        if(tunnelingOption.protocol == undefined || (tunnelingOption.protocol != 'tcp' && tunnelingOption.protocol != 'http' && tunnelingOption.protocol != 'https'))
            return false;
        if(tunnelingOption.destinationAddress == undefined || tunnelingOption.destinationAddress.trim().length == 0)
            return false;
        if(tunnelingOption.destinationPort == undefined || tunnelingOption.destinationPort <= 0 || tunnelingOption.destinationPort > 65535)
            return false;
        if(tunnelingOption.protocol != 'http' && tunnelingOption.protocol != 'https' && tunnelingOption.protocol != 'tcp') {
            return false;
        }

        if(tunnelingOption.protocol == 'http' || tunnelingOption.protocol == 'https') {
            if(tunnelingOption.httpOption == undefined)
                return false;
            if(tunnelingOption.httpOption.rewriteHostInTextBody == undefined)
                return false;
            if(tunnelingOption.httpOption.customRequestHeaders == undefined)
                return false;
            if(tunnelingOption.httpOption.customResponseHeaders == undefined)
                return false;
            if(tunnelingOption.httpOption.bodyRewriteRules == undefined)
                return false;
            if(tunnelingOption.httpOption.replaceAccessControlAllowOrigin == undefined)
                return false;
        }
        return true;

    }




}
export default ServerOptionCtrl;
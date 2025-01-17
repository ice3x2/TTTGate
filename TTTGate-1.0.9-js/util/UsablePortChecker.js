"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const net_1 = __importDefault(require("net"));
class UsablePortChecker {
    // noinspection JSUnusedLocalSymbols
    constructor() {
    }
    static async check(port) {
        if (!port || port < 0 || port > 65535)
            throw new Error("port is invalid (0 ~ 65535)");
        return new Promise((resolve) => {
            let server = net_1.default.createServer();
            server.on('error', () => {
                resolve(false);
            });
            server.on('listening', () => {
                server.close();
                resolve(true);
            });
            server.listen(port);
        });
    }
    static async checkPorts(ports) {
        let usablePorts = new Array();
        for (let port of ports) {
            let usable = await UsablePortChecker.check(port);
            if (usable) {
                usablePorts.push(port);
            }
        }
        return usablePorts;
    }
    static async findUsablePort(startPort, endPort) {
        for (let port = startPort; port <= endPort; port++) {
            let usable = await UsablePortChecker.check(port);
            if (usable) {
                return port;
            }
        }
        return -1;
    }
    static async findUsablePorts(startPort, endPort, count) {
        let ports = new Array();
        for (let port = startPort; port <= endPort; port++) {
            let usable = await UsablePortChecker.check(port);
            if (usable) {
                ports.push(port);
                if (count != null && ports.length == count) {
                    return ports;
                }
            }
        }
        return ports;
    }
    static async findUsedPorts(startPort, endPort) {
        let ports = new Array();
        for (let port = startPort; port <= endPort; port++) {
            let usable = await UsablePortChecker.check(port);
            if (!usable) {
                ports.push(port);
            }
        }
        return ports;
    }
}
exports.default = UsablePortChecker;

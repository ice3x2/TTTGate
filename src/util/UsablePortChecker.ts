import net from "net";


class UsablePortChecker {
    private constructor() {
    }

    public static async check(port: number) : Promise<boolean> {
        if(!port || port < 0 || port > 65535) throw new Error("port is invalid (0 ~ 65535)");
        return new Promise<boolean>((resolve, reject) => {
            let server = net.createServer();
            server.on('error', (error) => {
                resolve(false);
            });
            server.on('listening', () => {
                server.close();
                resolve(true);
            });
            server.listen(port);
        });
    }

    public static async checkPorts(ports: Array<number>) : Promise<Array<number>> {
        let usablePorts = new Array<number>();
        for(let port of ports) {
            let usable = await UsablePortChecker.check(port);
            if(usable) {
                usablePorts.push(port);
            }
        }
        return usablePorts;
    }

    public static async findUsablePort(startPort: number, endPort: number) : Promise<number> {
        for(let port = startPort; port <= endPort; port++) {
            let usable = await UsablePortChecker.check(port);
            if(usable) {
                return port;
            }
        }
        return -1;
    }

    public static async findUsablePorts(startPort: number, endPort: number, count?: number) : Promise<Array<number>> {
        let ports = new Array<number>();
        for(let port = startPort; port <= endPort; port++) {
            let usable = await UsablePortChecker.check(port);
            if(usable) {
                ports.push(port);
                if(count != null && ports.length == count) {
                    return ports;
                }
            }
        }
        return ports;
    }

    public static async findUsedPorts(startPort: number, endPort: number) : Promise<Array<number>> {
        let ports = new Array<number>();
        for(let port = startPort; port <= endPort; port++) {
            let usable = await UsablePortChecker.check(port);
            console.log(ports.length, port)
            if(!usable) {
                ports.push(port);
            }
        }
        return ports;
    }



}

export default UsablePortChecker;
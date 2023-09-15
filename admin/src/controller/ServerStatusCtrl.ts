
import {InvalidSession,type ClientStatus,type SysStatus} from "./Types";


class ServerStatusCtrl {

    private static _instance : ServerStatusCtrl;


    private constructor() {

    }



    public static get instance() : ServerStatusCtrl {
        if(!ServerStatusCtrl._instance) {
            ServerStatusCtrl._instance = new ServerStatusCtrl();
        }
        return ServerStatusCtrl._instance;
    }




    public async getStatus() : Promise<{system: SysStatus, clients: ClientStatus}> {
        let res = await fetch("/api/systemStatus", {
            method: "GET",
            credentials: "same-origin"
        });
        let json = await res.json();
        if(!json || res.status == 401) {
            throw new InvalidSession();
        }
        return json;
    }

}

export default ServerStatusCtrl;
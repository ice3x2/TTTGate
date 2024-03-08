import fetch from 'node-fetch';

import Logger from "../../util/logger/Logger";
import LoggerFactory from "../../util/logger/LoggerFactory";
import geoip from 'geoip-lite';
const LOG: Logger = LoggerFactory.getLogger('server', 'MyEnvironment');

class MyEnvironment {



    private static publicIP: string = "";
    private static country: string = "";





    get publicIP(): string {
        return MyEnvironment.publicIP;
    }






    public static  getPublicIP(): string {

        this.loadPublicIP().then((ip) => {
            MyEnvironment.publicIP = ip.trim();
            LOG.info('My public ip : ' + MyEnvironment.publicIP);
            let lookup = geoip.lookup(MyEnvironment.publicIP);
            if(lookup) {
                MyEnvironment.country = lookup.country;
                LOG.info('  > My Country : ' + MyEnvironment.country);
            }

        }).catch((err) => {
            console.error(err);
            MyEnvironment.publicIP = "0.0.0.0";
            LOG.error("Can't get public ip", err)
        });

        return MyEnvironment.publicIP;
    }

    private static async loadPublicIP(): Promise<string> {
        const response = await fetch('https://ifconfig.co/ip');
        return await response.text();
    }


}

export default MyEnvironment;
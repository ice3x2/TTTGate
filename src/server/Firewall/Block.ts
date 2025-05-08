import CountryCode from './CountryCode';
import geoip from 'geoip-lite';
import Environment from "../../Environment";
import Path from "path";
import Files from "../../util/Files";
import File from "../../util/File";


type BlockInfo = {
    code: string,
    country: string,
    count: number,
}

type BlockAddress = {
    address: string,
    count: number
}
const blockAddressMap : Map<string, BlockAddress> = new Map<string, BlockAddress>()

const appendBlockList = (address: string) => {
    let blockAddress = blockAddressMap.get(address);
    if(blockAddress) {
        blockAddress.count += 1;
    } else {
        blockAddress = {
            address: address,
            count: 1
        }
    }
    blockAddressMap.set(address, blockAddress);
}


abstract class Block {
    protected readonly blackList: Set<string> = new Set<string>();
    protected readonly whiteList: Set<string> = new Set<string>();
    protected  mode : 'white' | 'black'  = 'black';
    protected readonly port: number = -1;


    public abstract getConfigFilePath() : string;
    public abstract check(ipAddress: string) : boolean;
    constructor(port: number, mode?: 'white' | 'black') {
        this.port = port;
        this.mode = !mode ? 'black' : mode;

    }


    public commitList() {
        let path = this.getConfigFilePath();
        let file : File = new File(path);
        let data = {
            mode: this.mode,
            whiteList: Array.from(this.whiteList),
            blackList: Array.from(this.blackList)
        };
        Files.writeSync(file,JSON.stringify(data, null, 4));
    }

    public loadList() : boolean {
        let path = this.getConfigFilePath();
        let file: File = new File(path);
        if(file.exists()) {
            let dataStr = Files.toStringSync(file);
            if(!dataStr) {
                return false;
            }
            let data = JSON.parse(dataStr);
            this.mode = data.mode;
            this.whiteList.clear();
            data.whiteList.forEach((it: string) => {
                this.whiteList.add(it);
            });
            this.blackList.clear();
            data.blackList.forEach((it: string) => {
                this.blackList.add(it);
            });
        }
        return true;

    }


    public setMode(mode: 'white' | 'black') {
        this.mode = mode;
    }


    public getMode() : 'white' | 'black' {
        return this.mode;
    }


}


class CountryBlock extends Block {

    private readonly blockInfoMap : Map<string, BlockInfo> = new Map<string, BlockInfo>();
    private readonly countryCodeNameMap : Map<string, string> = new Map<string, string>();

    constructor(port: number, mode?: 'white' | 'black') {
        super(port, mode);
        Object.values(CountryCode).forEach((it) => {
            this.countryCodeNameMap.set(it.code, it.CountryNameEN);
        });
    }


    public setCountryCodes(codes: Array<string>) {
        codes.forEach((it) => {
            if(!this.countryCodeNameMap.has(it)) {
                return;
            }
            if(this.mode == 'white') {
                this.whiteList.add(it);
            } else if(this.mode == 'black') {
                this.blackList.add(it);
            }
        });
    }


    public getConfigFilePath() : string {
        return Path.join(Environment.path.configDir, 'country-block.' + this.port + '.json');
    }

    public removeCountryCode(code: string) {
        if(this.mode == 'white') {
            this.whiteList.delete(code);
        } else if(this.mode == 'black') {
            this.blackList.delete(code);
        }
    }


    public check(ipAddress: string) : boolean {
        if(this.mode == 'black' && this.blackList.size == 0) {
            return true;
        }
        let lookup = geoip.lookup(ipAddress);
        let result = false;
        let country = 'unknown';
        if(lookup) {
            country = lookup.country;
            if(this.mode == 'white') {
                result = this.whiteList.has(country);
            } else if(this.mode == 'black') {
                result = !this.blackList.has(country);
            }
        }
        if(!result) {
            let info = this.blockInfoMap.get(country);
            if(info) {
                info.count += 1;
                appendBlockList(ipAddress);
            } else {
                let countryName = this.countryCodeNameMap.get(country);
                if(!countryName) {
                    countryName = 'unknown';
                }
                info = {
                    code: country,
                    country:countryName,
                    count: 1,
                }
                appendBlockList(ipAddress);
                this.blockInfoMap.set(country, info);

            }
        }
        return result;
    }

    public countryCodeNameList() : Array<{code: string, name: string}> {
        let list : Array<{code: string, name: string}> = [];
        this.countryCodeNameMap.forEach((name, code) => {
            list.push({code: code, name: name});
        });
        return list;
    }

}


class AddressBlock extends Block {

    constructor(port: number, mode?: 'white' | 'black') {
        super(port, mode);
    }


    public getConfigFilePath() : string {
        let path = Path.join(Environment.path.configDir, 'address-block.' + this.port + '.json');
        return path;
    }


    public check(ipAddress: string) : boolean {
        if(this.mode == 'black' && this.blackList.size == 0) {
            return true;
        }
        let result = false;

        if(this.mode == 'white') {
            result = this.whiteList.has(ipAddress);
        } else if(this.mode == 'black') {
            result = !this.blackList.has(ipAddress);
        }

        if(!result) {
            appendBlockList(ipAddress);
        }
        return result;
    }

}


export {Block, CountryBlock, AddressBlock, BlockAddress};



import CountryCode from './CountryCode';
import geoip from 'geoip-lite';
import Environment from "../../Environment";
import Path from "path";
import Files from "../../util/Files";
import File from "../../util/File";


type BlockAddress = {
    address: string,
    count: number,
}

type BlockInfo = {
    code: string,
    country: string,
    count: number,
    blockCountMap: Map<string, BlockAddress>
}
class CountryBlock {

    private readonly countryCodeNameMap : Map<string, string> = new Map<string, string>();
    private readonly name: string = '';

    private blockInfoMap: Map<string, BlockInfo> = new Map<string, BlockInfo>();
    private mode : 'white' | 'black' | 'none' = 'none';
    private readonly blackList: Set<string> = new Set<string>();
    private readonly whiteList: Set<string> = new Set<string>();


    constructor(name: string, mode?: 'white' | 'black') {
        Object.values(CountryCode).forEach((it) => {
            this.countryCodeNameMap.set(it.code, it.CountryNameEN);
        });
        this.name = name;
        this.mode = !mode ? 'none' : mode;
    }

    public getMode() : 'white' | 'black' | 'none' {
        return this.mode;
    }

    public addCountryCode(code: string) {
        if(this.mode == 'white') {
            this.whiteList.add(code);
        } else if(this.mode == 'black') {
            this.blackList.add(code);
        }
        this.commitList();
    }

    public setMode(mode: 'white' | 'black' | 'none') {
        this.mode = mode;
        this.commitList();
    }


    private getConfigFilePath() : string {
        let path = Path.join(Environment.path.configDir, 'country-block.' + this.name + '.json');
        return path;
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

    public removeCountryCode(code: string) {
        if(this.mode == 'white') {
            this.whiteList.delete(code);
        } else if(this.mode == 'black') {
            this.blackList.delete(code);
        }
    }


    public check(ipAddress: string) : boolean {
        if(this.mode == 'none') {
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
                this.appendBlockList(info.blockCountMap, ipAddress);
            } else {
                let countryName = this.countryCodeNameMap.get(country);
                if(!countryName) {
                    countryName = 'unknown';
                }
                info = {
                    code: country,
                    country:countryName,
                    count: 1,
                    blockCountMap: new Map<string, BlockAddress>()
                }
                this.appendBlockList(info.blockCountMap, ipAddress);
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

    private appendBlockList(blockCountMap : Map<string, BlockAddress>, address: string) {
        let blockAddress = blockCountMap.get(address);
        if(blockAddress) {
            blockAddress.count += 1;
        } else {
            blockAddress = {
                address: address,
                count: 1
            }
        }
        blockCountMap.set(address, blockAddress);
    }




}
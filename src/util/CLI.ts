

class CLI {
    public static readSimpleOptions = () : { [key: string]: string } => {

        let result : { [key: string]: string } = {};
        let items : Array<string> = process.argv;
        let currentKey : string = "";
        for(let item of items) {
            if(item.startsWith("-") && item.length > 1) {
                currentKey = item.replace(/^[-]+/ig,"");
                let idx = currentKey.indexOf("=");
                if(idx > 0) {
                    let key = currentKey.substring(0, idx);
                    let value = currentKey.substring(idx+1);
                    result[key] = value;
                    currentKey = "";
                } else {
                    result[currentKey] = "";
                }
            } else if(!item) {}
            else {
                if(result[currentKey] != undefined) {
                    result[currentKey] = item;
                    currentKey = "";
                }
            }
        }
        return result;
    }


}


export default CLI;

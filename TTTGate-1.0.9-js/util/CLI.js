"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
class CLI {
    static readSimpleOptions = () => {
        let result = {};
        let items = process.argv;
        let currentKey = "";
        for (let item of items) {
            if (item.startsWith("-") && item.length > 1) {
                currentKey = item.replace(/^[-]+/ig, "");
                let idx = currentKey.indexOf("=");
                if (idx > 0) {
                    let key = currentKey.substring(0, idx);
                    let value = currentKey.substring(idx + 1);
                    result[key] = value;
                    currentKey = "";
                }
                else {
                    result[currentKey] = "";
                }
            }
            else if (!item) { }
            else {
                if (result[currentKey] != undefined) {
                    result[currentKey] = item;
                    currentKey = "";
                }
            }
        }
        return result;
    };
}
exports.default = CLI;

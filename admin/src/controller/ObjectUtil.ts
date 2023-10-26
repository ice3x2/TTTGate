

import _ from "lodash";
// noinspection DuplicatedCode
interface UpdateInfo {
    [key: string]: any | UpdateInfo;
}

// noinspection DuplicatedCode
class ObjectUtil {

    public static findUpdates<T>(originValue: T, newValue: T) :  UpdateInfo {
        // @ts-ignore
        let originValueKeys = Object.keys(originValue);
        // @ts-ignore
        let newValueKeys = Object.keys(newValue);

        let updates: UpdateInfo = {};
        for (const key of newValueKeys) {
            if(!originValueKeys.includes(key)) {
                // @ts-ignore
                updates[key] = newValue[key];
            } else {
                // @ts-ignore
                let originValueValue = originValue[key];
                // @ts-ignore
                let newValueValue = newValue[key];
                if(typeof originValueValue == 'object') {
                    let subUpdates = ObjectUtil.findUpdates(originValueValue, newValueValue);
                    if(Object.keys(subUpdates).length > 0) {
                        updates[key] = subUpdates;
                    }
                } else {
                    if(originValueValue != newValueValue) {
                        updates[key] = newValueValue;
                    }
                }
            }
        }
        return updates;
    }


    private static cloneValue<T>(value: T) : T | undefined{
        if(value === null) {
            return undefined;
        } else if(value === undefined) {
            return undefined;
        } else if(value instanceof Array) {
            let result: Array<any> = [];
            for(let v of value) {
                result.push(ObjectUtil.cloneValue(v));
            }
            return result as any;
        } else if(value instanceof Map) {
            let value = new Map();
            value.forEach((v, k) => {
                value.set(k, ObjectUtil.cloneValue(v));
            });
            return value as any;
        } else if(value instanceof Set) {
            let value = new Set();
            value.forEach((v) => {
                value.add(ObjectUtil.cloneValue(v));
            });
            return value as any;
        } else if (value instanceof Date) {
             return new Date(value.getDate()) as any;
        } else if(typeof value == 'object') {
            return _.cloneDeep(value);
        } else {
            return value;
        }


    }

    public static equalsDeep<T>(obj1: T | undefined, obj2: T | undefined) : boolean {
        if(obj1 == undefined && obj2 == undefined) {
            return true;
        } else if(obj1 == undefined || obj2 == undefined) {
            return false;
        }

        let keys1 = Object.keys(obj1);
        let keys2 = Object.keys(obj2);
        if(keys1.length != keys2.length) {
            return false;
        }
        for(let key of keys1) {
            // @ts-ignore
            let value1 = obj1[key];
            // @ts-ignore
            let value2 = obj2[key];
            if(typeof value1 == 'object') {
                if(!ObjectUtil.equalsDeep(value1, value2)) {
                    return false;
                }
            } else {
                if(value1 != value2) {
                    return false;
                }
            }
        }
        return true;
    }
}


export default ObjectUtil;


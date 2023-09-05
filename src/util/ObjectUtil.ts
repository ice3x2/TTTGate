
// noinspection DuplicatedCode
interface UpdateInfo {
    [key: string]: any | UpdateInfo;
}

// noinspection DuplicatedCode
class ObjectUtil {


    public isDefined<T>(value: T | undefined) : value is T {
        return value !== undefined;
    }

    public static findUpdates<T extends object>(originValue: T, newValue: T) :  UpdateInfo {
        if(originValue == null && newValue != null) {
            return newValue;
        } else if(newValue == null) {
            return {};
        }
        let originValueKeys = Object.keys(originValue);
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

    public static intersectionKey<T extends object>(originValue: any, newValue: any) :  Array<string> {
        if(originValue == null || newValue == null || typeof originValue != 'object' || typeof newValue != 'object') {
            return [];
        }
        let originValueKeys = Object.keys(originValue);
        let newValueKeys = Object.keys(newValue);
        let result = new Array<string>();
        for (const key of newValueKeys) {
            if(originValueKeys.includes(key)) {
                result.push(key);
            }
        }
        return result;
    }


    public static equalsType(origin: any, value: any) : boolean {
        let originKeys = Object.keys(origin);
        let valueKeys = Object.keys(value);
        for (let originKey of originKeys) {
            if(!valueKeys.includes(originKey)) {
                return false;
            }
            let originValue = origin[originKey];
            let valueValue = value[originKey];
            if(typeof originValue != typeof valueValue) {
                return false;
            }
            if(typeof originValue == 'object') {
                if(!this.equalsType(originValue, valueValue)) {
                    return false;
                }
            }
        }
        return true;
    }

    public static  cloneDeep<T extends object>(obj: T) : T {

        let keys = Object.keys(obj);
        let newObj: any = {};
        for(let key of keys) {
            // @ts-ignore
            let value = obj[key];
            if(value === null) {
                newObj[key] = null;
            } else if(value === undefined) {
                newObj[key] = undefined;
            }
            else if(value instanceof Array) {
                newObj[key] = value.slice();
            } else if(value instanceof Map) {
                newObj[key] = new Map(value);
            } else if(value instanceof Set) {
                newObj[key] = new Set(value);
            } else if (value instanceof Date) {
                newObj[key] = new Date(value);
            } else if(typeof value == 'object') {
                newObj[key] = ObjectUtil.cloneDeep(value);
            } else {
                newObj[key] = value;
            }
        }
        return newObj;
    }

    public static equalsDeep<T extends object>(obj1: T, obj2: T) : boolean {
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
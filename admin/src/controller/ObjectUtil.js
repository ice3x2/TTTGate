// noinspection DuplicatedCode
class ObjectUtil {
    static findUpdates(originValue, newValue) {
        let originValueKeys = Object.keys(originValue);
        let newValueKeys = Object.keys(newValue);
        let updates = {};
        for (const key of newValueKeys) {
            if (!originValueKeys.includes(key)) {
                updates[key] = newValue[key];
            }
            else {
                let originValueValue = originValue[key];
                let newValueValue = newValue[key];
                if (typeof originValueValue == 'object') {
                    let subUpdates = ObjectUtil.findUpdates(originValueValue, newValueValue);
                    if (Object.keys(subUpdates).length > 0) {
                        updates[key] = subUpdates;
                    }
                }
                else {
                    if (originValueValue != newValueValue) {
                        updates[key] = newValueValue;
                    }
                }
            }
        }
        return updates;
    }
    static cloneDeep(obj) {
        if (!obj || typeof obj != 'object' || obj instanceof Date || obj instanceof Map || obj instanceof Set || obj instanceof Array) {
            return ObjectUtil.cloneValue(obj);
        }
        let keys = Object.keys(obj);
        let newObj = {};
        for (let key of keys) {
            // @ts-ignore
            let value = obj[key];
            newObj[key] = ObjectUtil.cloneValue(value);
        }
        return newObj;
    }
    static cloneValue(value) {
        if (value === null) {
            return null;
        }
        else if (value === undefined) {
            return undefined;
        }
        else if (value instanceof Array) {
            let result = [];
            for (let v of value) {
                result.push(ObjectUtil.cloneValue(v));
            }
            return result;
        }
        else if (value instanceof Map) {
            let value = new Map();
            value.forEach((v, k) => {
                value.set(k, ObjectUtil.cloneValue(v));
            });
            return value;
        }
        else if (value instanceof Set) {
            let value = new Set();
            value.forEach((v) => {
                value.add(ObjectUtil.cloneValue(v));
            });
            return value;
        }
        else if (value instanceof Date) {
            return new Date(value.getDate());
        }
        else if (typeof value == 'object') {
            return ObjectUtil.cloneDeep(value);
        }
        else {
            return value;
        }
    }
    static equalsDeep(obj1, obj2) {
        if (obj1 == undefined && obj2 == undefined) {
            return true;
        }
        else if (obj1 == undefined || obj2 == undefined) {
            return false;
        }
        let keys1 = Object.keys(obj1);
        let keys2 = Object.keys(obj2);
        if (keys1.length != keys2.length) {
            return false;
        }
        for (let key of keys1) {
            let value1 = obj1[key];
            let value2 = obj2[key];
            if (typeof value1 == 'object') {
                if (!ObjectUtil.equalsDeep(value1, value2)) {
                    return false;
                }
            }
            else {
                if (value1 != value2) {
                    return false;
                }
            }
        }
        return true;
    }
}
export default ObjectUtil;
//# sourceMappingURL=ObjectUtil.js.map
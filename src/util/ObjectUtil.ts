
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

    /**
     * P7-T1 / REQ-17: canonical(키 정렬 + 배열 정규화) 기반 deep 비교.
     *
     * 기존 `equalsDeep`는 Object.keys 순서 의존이 없고 인덱스 기반 배열 비교를 수행하지만,
     * trustedClients 같은 "논리적 집합" 성격 배열은 요소 순서가 의미 없으므로 canonical
     * 비교가 필요하다. 본 헬퍼는 다음을 수행한다:
     *  - 객체: 키를 정렬 후 재귀 비교
     *  - 배열: 각 요소를 canonical 문자열로 직렬화 후 정렬한 결과를 비교
     *  - 원시값: `==` 비교(기존 equalsDeep와 일관)
     *
     * 주의: 본 헬퍼의 목적은 "변경 감지"이므로, 수치적으로 동일하지만 형식이 다른 값
     * (예: "1" vs 1) 은 원시 `==` 비교 특성상 같다고 판정될 수 있다. trustedClients 같은
     * 문자열 필드 구성에서는 무해하다.
     */
    public static canonicalEquals(a: any, b: any) : boolean {
        return ObjectUtil.canonicalSerialize(a) === ObjectUtil.canonicalSerialize(b);
    }

    private static canonicalSerialize(v: any): string {
        if(v === null || v === undefined) return JSON.stringify(null);
        if(Array.isArray(v)) {
            const items = v.map((item) => ObjectUtil.canonicalSerialize(item));
            items.sort();
            return '[' + items.join(',') + ']';
        }
        if(typeof v === 'object') {
            const keys = Object.keys(v).sort();
            const parts: string[] = [];
            for(const k of keys) {
                parts.push(JSON.stringify(k) + ':' + ObjectUtil.canonicalSerialize(v[k]));
            }
            return '{' + parts.join(',') + '}';
        }
        return JSON.stringify(v);
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
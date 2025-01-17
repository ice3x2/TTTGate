interface UpdateInfo {
    [key: string]: any | UpdateInfo;
}
declare class ObjectUtil {
    isDefined<T>(value: T | undefined): value is T;
    static findUpdates<T extends object>(originValue: T, newValue: T): UpdateInfo;
    static intersectionKey<T extends object>(originValue: any, newValue: any): Array<string>;
    static equalsType(origin: any, value: any): boolean;
    static cloneDeep<T extends object>(obj: T): T;
    static equalsDeep<T extends object>(obj1: T, obj2: T): boolean;
}
export default ObjectUtil;

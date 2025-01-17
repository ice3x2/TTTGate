declare class ExMath {
    static map(value: number, in_min: number, in_max: number, out_min: number, out_max: number): number;
    static floor(value: number, precision: number): number;
    static ceil(value: number, precision: number): number;
    static round(value: number, precision: number): number;
}
export default ExMath;

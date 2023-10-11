class ExMath {
    static map(value, in_min, in_max, out_min, out_max) {
        return (value - in_min) * (out_max - out_min) / (in_max - in_min) + out_min;
    }
    static floor(value, precision) {
        let pow = Math.pow(10, precision);
        return Math.floor(value * pow) / pow;
    }
    static ceil(value, precision) {
        let pow = Math.pow(10, precision);
        return Math.ceil(value * pow) / pow;
    }
    static round(value, precision) {
        let pow = Math.pow(10, precision);
        return Math.round(value * pow) / pow;
    }
}
export default ExMath;
//# sourceMappingURL=ExMath.js.map
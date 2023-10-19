

class ExMath {
    public static map(value: number, in_min: number, in_max: number, out_min: number, out_max: number) : number {
        return (value - in_min) * (out_max - out_min) / (in_max - in_min) + out_min;
    }
    public static floor(value: number, precision: number) : number {
        let pow = Math.pow(10, precision);
        return Math.floor(value * pow) / pow;


    }

    public static ceil(value: number, precision: number) : number {
        let pow = Math.pow(10, precision);
        return Math.ceil(value * pow) / pow;
    }

    public static round(value: number, precision: number) : number {
        let pow = Math.pow(10, precision);
        return Math.round(value * pow) / pow;
    }
}

export default ExMath;
import ExMath from '../../controller/ExMath';

// 화면들이 함께 쓰는 표시 단위 변환. 옛 ServerStatusLayout 과 SysinfoPopup 에
// 같은 함수가 두 벌 있던 것을 한 곳으로 모았다.

export const byteToUnit = (length: number, hideUnit = false): string => {
    const tib = 1024 * 1024 * 1024 * 1024;
    const gib = 1024 * 1024 * 1024;
    const mib = 1024 * 1024;
    const kib = 1024;
    if(length > tib) {
        return `${ExMath.round(length / tib, 1)}${hideUnit ? '' : 'TiB'}`;
    } else if(length > gib) {
        return `${ExMath.round(length / gib, 1)}${hideUnit ? '' : 'GiB'}`;
    } else if(length > mib) {
        return `${ExMath.round(length / mib, 1)}${hideUnit ? '' : 'MiB'}`;
    } else if(length > kib) {
        return `${ExMath.round(length / kib, 1)}${hideUnit ? '' : 'KiB'}`;
    } else {
        return `${length}${hideUnit ? '' : 'B'}`;
    }
};

export const timeToDMH = (ms: number): string => {
    const time = ms / 1000;
    const day = Math.floor(time / (24 * 60 * 60));
    const hour = Math.floor((time % (24 * 60 * 60)) / (60 * 60));
    const min = Math.floor((time % (60 * 60)) / 60);
    const sec = Math.floor(time % 60);
    return `${day}d ${hour}h ${min}m ${sec}s`;
};

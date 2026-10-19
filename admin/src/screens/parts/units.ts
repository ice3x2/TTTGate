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

// 옛 TunnelOptionSetLayout 의 _startupTime 을 옮겼다. 시작 시각에서 지금까지 흐른 시간을 가장 큰 두 단위로 적는다.
// 경과 시간의 0 하한만 원본과 다르다. uptime 은 서버 시각인데 빼는 쪽은 클라이언트 시계라서,
// 클라이언트 시계가 서버보다 늦으면 원본은 "-5s" 같은 음수를 찍었다.
export const startupTime = (uptime: number): string => {
    if(!uptime) {
        return '0s';
    }
    const time = Math.max(0, Date.now() - uptime);
    if(time > 1000 * 60 * 60 * 24) {
        return Math.floor(time / (1000 * 60 * 60 * 24)) + 'd, ' + Math.floor((time % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60)) + 'h';
    } else if(time > 1000 * 60 * 60) {
        return Math.floor(time / (1000 * 60 * 60)) + 'h, ' + Math.floor((time % (1000 * 60 * 60)) / (1000 * 60)) + 'm';
    } else if(time > 1000 * 60) {
        return Math.floor(time / (1000 * 60)) + 'm';
    } else {
        return Math.floor(time / 1000) + 's';
    }
};

// 옛 TunnelOptionSetLayout 의 _toSize·_floorPoint 그대로. 소수 둘째 자리까지 내림한다.
export const toSize = (bytes: number): string => {
    if(bytes > 1024 * 1024 * 1024) {
        return ExMath.floor(bytes / (1024 * 1024 * 1024), 2) + 'Gb';
    } else if(bytes > 1024 * 1024) {
        return ExMath.floor(bytes / (1024 * 1024), 2) + 'Mb';
    } else if(bytes > 1024) {
        return ExMath.floor(bytes / 1024, 2) + 'Kb';
    } else {
        return bytes + 'B';
    }
};

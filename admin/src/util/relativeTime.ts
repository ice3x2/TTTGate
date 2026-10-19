// U4-06: 세션·감사 화면의 시각 표기. Jest(CommonJS 변환)로 직접 테스트하므로 순수 함수와 export 만 둔다.

export function relativeTime(fromMs: number, nowMs: number): string {
    const seconds = Math.floor(Math.max(0, nowMs - fromMs) / 1000);
    if(seconds < 60) return 'just now';
    const minutes = Math.floor(seconds / 60);
    if(minutes < 60) return `${minutes} min ago`;
    const hours = Math.floor(minutes / 60);
    if(hours < 24) return `${hours} h ago`;
    return `${Math.floor(hours / 24)} d ago`;
}

const pad = (value: number): string => String(value).padStart(2, '0');

export function formatLocal(ms: number, withSeconds: boolean): string {
    const date = new Date(ms);
    const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
    const time = `${pad(date.getHours())}:${pad(date.getMinutes())}` + (withSeconds ? `:${pad(date.getSeconds())}` : '');
    return `${day} ${time}`;
}

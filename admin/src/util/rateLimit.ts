import type {RateLimitOption} from '../controller/Types';

// U5-06: 서버 src/types/TunnelingOption.ts 의 defaultRateLimit 사본이다(관리자 번들은 서버 TS 를 import 하지 않는다).
// 값이 다르면 서버 응답이 기준이다. Jest 가 직접 부르므로 순수 함수만 둔다.
export function defaultRateLimit(protocol: 'tcp' | 'http' | 'https' | undefined): RateLimitOption {
    const http = protocol === 'http' || protocol === 'https';
    return {enabled: true, windowMs: 60_000, maxConnections: http ? 300 : 30, banMs: 600_000, customized: false};
}

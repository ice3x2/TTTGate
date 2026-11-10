export type AdmissionScope = {kind: 'tunnel'; port: number; protocol: 'tcp' | 'http' | 'https'} | {kind: 'admin'};
// 이슈 348: activator-ip 는 터널을 켠 사람의 IP 가 아니라서 거부한 연결이다.
export type AdmissionReason = 'ip-blocklist' | 'geo-deny' | 'rate-limit-ban' | 'rate-limit-exceeded' | 'concurrency-limit' | 'activator-ip';
export type AdmissionDenial = {allowed: false; reason: AdmissionReason; retryAfterMs?: number};
export type AdmissionDecision = {allowed: true} | AdmissionDenial;

export interface AdmissionPolicy {
    admit(scope: AdmissionScope, remoteAddress: string | undefined, now?: number): AdmissionDecision;
}

// 허용 판정은 이 상수 하나를 재사용한다(할당 0).
export const ADMIT: AdmissionDecision = Object.freeze({allowed: true});

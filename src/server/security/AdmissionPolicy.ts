export type AdmissionScope = {kind: 'tunnel'; port: number; protocol: 'tcp' | 'http' | 'https'} | {kind: 'admin'};
export type AdmissionReason = 'geo-deny' | 'rate-limit-ban' | 'rate-limit-exceeded' | 'concurrency-limit';
export type AdmissionDecision = {allowed: true} | {allowed: false; reason: AdmissionReason; retryAfterMs?: number};

export interface AdmissionPolicy {
    admit(scope: AdmissionScope, remoteAddress: string | undefined, now?: number): AdmissionDecision;
}

// 허용 판정은 이 상수 하나를 재사용한다(할당 0).
export const ADMIT: AdmissionDecision = Object.freeze({allowed: true});

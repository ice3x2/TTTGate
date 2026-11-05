import {AdmissionReason} from "./AdmissionPolicy";

/** 거절이 일어난 곳. 터널 외부 포트 번호이거나 관리 화면이다. */
export type DenialScope = number | 'admin';

export type DenialCounts = Record<AdmissionReason, number>;

const emptyCounts = (): DenialCounts =>
    ({'ip-blocklist': 0, 'geo-deny': 0, 'rate-limit-ban': 0, 'rate-limit-exceeded': 0, 'concurrency-limit': 0});

/**
 * #327 REQ-1: 범위·사유별 누적 거절 건수. 프로세스가 도는 동안 늘기만 한다.
 * 터널을 다시 설정하거나 해제해도 지우지 않는다(같은 포트의 건수가 화면마다 갈리지 않게).
 */
export class DenialTally {
    private readonly _counts = new Map<DenialScope, DenialCounts>();

    public add(scope: DenialScope, reason: AdmissionReason): void {
        let counts = this._counts.get(scope);
        if (!counts) {
            counts = emptyCounts();
            this._counts.set(scope, counts);
        }
        counts[reason]++;
    }

    public counts(scope: DenialScope): Readonly<DenialCounts> {
        return this._counts.get(scope) ?? emptyCounts();
    }

    /** 거절이 1건 이상 있었던 터널 포트. */
    public ports(): number[] {
        return [...this._counts.keys()].filter((scope): scope is number => scope !== 'admin');
    }
}

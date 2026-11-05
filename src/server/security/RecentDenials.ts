import {AdmissionReason} from "./AdmissionPolicy";
import {DenialScope} from "./DenialTally";

export type RecentDenial = {at: number; ip: string; scope: DenialScope; reason: AdmissionReason};

export const RECENT_DENIAL_CAPACITY = 200;

/**
 * #327 REQ-4: 최근 거절을 정해진 수만큼 메모리에 둔다. 넘으면 가장 오래된 것부터 덮어쓴다.
 * 기록은 배열 한 칸을 바꾸는 일뿐이다(O(1). 판정 경로에서 I/O 와 국가 조회를 하지 않는다).
 */
export class RecentDenials {
    private readonly _ring: Array<RecentDenial | undefined>;
    private _next = 0;

    constructor(private readonly _capacity: number = RECENT_DENIAL_CAPACITY) {
        this._ring = new Array(_capacity);
    }

    public add(denial: RecentDenial): void {
        this._ring[this._next] = denial;
        this._next = (this._next + 1) % this._capacity;
    }

    /** 최신 순. */
    public list(): RecentDenial[] {
        const result: RecentDenial[] = [];
        for (let i = 1; i <= this._capacity; i++) {
            const entry = this._ring[(this._next - i + this._capacity) % this._capacity];
            if (entry) result.push({...entry});
        }
        return result;
    }
}

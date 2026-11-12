import {auditEventName, auditTypeOption} from "../../admin/src/screens/parts/auditEvent";
import {translator} from "../../admin/src/i18n";
import {AUDIT_EVENT_TYPE_LIST} from "../../src/server/audit/AuditEventTypes";

// 이슈 349 FR-12·AC-8 — 감사 화면은 이벤트 이름을 번역해 보이고 원래 코드 값을 함께 보인다. 번역 맵에 없는 코드는 코드 값만 보인다.
describe("auditEventName", () => {
    const ko = translator("ko");
    const en = translator("en");

    test("tunnel_activated 는 한국어 이름이 있다", () => {
        expect(auditEventName("tunnel_activated", ko)).toBe("터널 켜짐");
        expect(auditEventName("tunnel_activated", en)).toBe("Tunnel turned on");
    });

    test("번역 맵에 없는 코드는 이름이 없다", () => {
        expect(auditEventName("brand_new_event", ko)).toBeUndefined();
        expect(auditEventName("toString", ko)).toBeUndefined();
    });

    // 검토 LOW: 이벤트 이름은 '대상 + 동작' 의 명사형으로 맞춘다("터널 켬" 이 아니라 "터널 켜짐").
    test("한국어 이벤트 이름은 명사형이다", () => {
        expect(auditEventName("tunnel_deactivated", ko)).toBe("터널 꺼짐");
        expect(auditEventName("session_killed", ko)).toBe("세션 종료");
        expect(auditEventName("trusted_client_secret_rotated", ko)).toBe("신뢰 클라이언트 비밀값 재발급");
        // 검토 L-6: 2단계 인증 수단을 더하고 빼는 일은 등록·해제다. 켜짐·꺼짐은 터널의 상태에 쓴다.
        expect(auditEventName("mfa_enrolled", ko)).toBe("2단계 인증 켜짐");
        expect(auditEventName("mfa_disabled", ko)).toBe("2단계 인증 꺼짐");
        expect(AUDIT_EVENT_TYPE_LIST.filter((code) => /(켬|끔|냄|듦)$/.test(auditEventName(code, ko) ?? ""))).toEqual([]);
    });

    test("서버의 모든 감사 이벤트 코드에 이름이 있다", () => {
        expect(AUDIT_EVENT_TYPE_LIST.filter((code) => auditEventName(code, ko) === undefined || auditEventName(code, en) === undefined)).toEqual([]);
    });
});

describe("auditTypeOption — 종류 선택 목록의 항목", () => {
    test("값은 코드이고, 글자는 이름과 코드다", () => {
        expect(auditTypeOption("tunnel_activated", translator("ko"))).toEqual({value: "tunnel_activated", label: "터널 켜짐 (tunnel_activated)"});
    });

    test("번역 맵에 없는 코드는 코드 값만 보인다", () => {
        expect(auditTypeOption("brand_new_event", translator("ko"))).toEqual({value: "brand_new_event", label: "brand_new_event"});
    });
});

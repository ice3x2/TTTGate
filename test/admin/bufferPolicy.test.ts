import {DEFAULT_GROUP_ATTRIBUTES, type GroupAttributes, type MeResponse, type Role} from "../../admin/src/controller/Types";
import {bufferIssue, defaultBuffer, groupBufferCap} from "../../admin/src/screens/parts/bufferPolicy";

// 이슈 366 FR-10~FR-12 — 터널 편집 화면의 그룹 연결당 버퍼 최댓값 안내(순수 함수). 최종 판정은 서버가 한다.
const meOf = (role: Role, attributes: Partial<GroupAttributes>): MeResponse => ({
    user: {id: "", username: "", displayName: "", role, status: "active", groupId: "", groupName: "",
        mustChangePassword: false, migratedFromLegacyAdmin: false, createdAt: 0, updatedAt: 0},
    group: {id: "", name: "", attributes: {...DEFAULT_GROUP_ATTRIBUTES, ...attributes}},
    sections: [],
    migrationBanner: false,
});

describe("이슈 366 버퍼 최댓값", () => {
    test("일반 사용자는 그룹 상한(0 보다 클 때)을, 슈퍼유저와 상한 0 은 null 을 받는다", () => {
        expect(groupBufferCap(meOf("regular", {max_session_buffer_mib: 64}))).toBe(64);
        expect(groupBufferCap(meOf("regular", {max_session_buffer_mib: 0}))).toBeNull();
        expect(groupBufferCap(meOf("superuser", {max_session_buffer_mib: 64}))).toBeNull();
        expect(groupBufferCap(meOf("regular", {}))).toBeNull();
    });

    test("AC-9 새 터널의 기본 버퍼는 min(10, 상한)이다", () => {
        expect(defaultBuffer(null)).toBe(10);
        expect(defaultBuffer(64)).toBe(10);
        expect(defaultBuffer(8)).toBe(8);
    });

    test("상한을 넘는 새 값은 over, 저장된 값을 그대로 두면 stored-over 경고, 그 밖은 없음", () => {
        expect(bufferIssue("server", 65, undefined, 64)).toBe("over");
        expect(bufferIssue("server", 64, undefined, 64)).toBeUndefined();
        expect(bufferIssue("client", 0, undefined, 64)).toBe("over");
        expect(bufferIssue("client", -1, undefined, 64)).toBe("over");
        expect(bufferIssue("client", -1, -1, 64)).toBe("stored-over");
        expect(bufferIssue("server", 128, 128, 64)).toBe("stored-over");
        expect(bufferIssue("server", 96, 128, 64)).toBe("over");
        expect(bufferIssue("server", 128, 128, null)).toBeUndefined();
        expect(bufferIssue("client", -1, undefined, null)).toBeUndefined();
        expect(bufferIssue("server", null, undefined, 64)).toBeUndefined();
    });
});

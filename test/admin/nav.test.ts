import {chrome, defaultHash, navScreen, NAV, SECTION_OF_SCREEN, visibleNav} from "../../admin/src/shell/nav";

// U3-01 / #103 — 내비게이션 순수 함수. 섹션으로 드로어 항목과 기본 해시를 정한다.

const SUPERUSER_SECTIONS = ["status", "tunnels", "server", "users", "groups", "security", "audit", "sessions", "me"];

describe("nav", () => {
    test("chrome 은 새 화면의 제목과 뒤로 가기를 준다", () => {
        expect(chrome({screen: "users"})).toEqual({title: "Users"});
        expect(chrome({screen: "user-edit", param: "new"})).toEqual({title: "New user", back: "#/users"});
        expect(chrome({screen: "user-edit", param: "u_0123456789abcdef"})).toEqual({title: "User", back: "#/users"});
        expect(chrome({screen: "groups"})).toEqual({title: "Groups"});
        expect(chrome({screen: "group-edit", param: "new"})).toEqual({title: "New group", back: "#/groups"});
        expect(chrome({screen: "group-edit", param: "default"})).toEqual({title: "Group", back: "#/groups"});
        expect(chrome({screen: "me"})).toEqual({title: "My account"});
        expect(chrome({screen: "me-password"})).toEqual({title: "Change password", back: "#/me"});
        expect(chrome({screen: "denied"})).toEqual({title: "No access"});
        expect(chrome({screen: "audit"})).toEqual({title: "Audit log"});
        expect(chrome({screen: "sessions"})).toEqual({title: "Sessions"});
        expect(chrome({screen: "security"})).toEqual({title: "Security"});
        expect(chrome({screen: "clients"})).toEqual({title: "Trusted clients"});
        // 기존 행은 그대로다.
        expect(chrome({screen: "tunnel-edit", param: "new"})).toEqual({title: "New tunnel", back: "#/tunnels"});
        expect(chrome({screen: "status"})).toEqual({title: "Status"});
    });

    test("navScreen 은 편집 화면을 목록 항목으로 묶는다", () => {
        expect(navScreen({screen: "group-edit", param: "default"})).toBe("groups");
        expect(navScreen({screen: "user-edit", param: "new"})).toBe("users");
        expect(navScreen({screen: "me-password"})).toBe("me");
        expect(navScreen({screen: "tunnel-edit", param: "1"})).toBe("tunnels");
        expect(navScreen({screen: "denied"})).toBe("denied");
    });

    test("NAV 는 10개 항목을 정해진 순서로 갖는다(#213 이 Server settings 뒤에 Trusted clients 를 넣었다)", () => {
        expect(NAV.map((item) => item.title)).toEqual(["Status", "Tunnels", "Server settings", "Trusted clients", "Users", "Groups", "Security", "Audit log", "Sessions", "My account"]);
        // 편집 화면이 목록과 같은 섹션이어야 가드가 #/users/new 같은 해시도 막는다.
        expect(SECTION_OF_SCREEN).toEqual({
            status: "status", tunnels: "tunnels", "tunnel-edit": "tunnels", server: "server",
            users: "users", "user-edit": "users", groups: "groups", "group-edit": "groups",
            me: "me", "me-password": null, denied: null,
            audit: "audit", sessions: "sessions", security: "security", clients: "server",
        });
    });

    test("visibleNav 는 섹션에 있는 항목만 순서대로 돌려준다", () => {
        expect(visibleNav(SUPERUSER_SECTIONS).map((item) => item.title)).toEqual(NAV.map((item) => item.title));
        expect(visibleNav(["tunnels", "audit", "me", "sessions"]).map((item) => item.title)).toEqual(["Tunnels", "Audit log", "Sessions", "My account"]);
        const hashes = visibleNav(SUPERUSER_SECTIONS).map((item) => item.hash);
        expect(hashes.indexOf("#/audit")).toBeLessThan(hashes.indexOf("#/sessions"));
        expect(hashes.indexOf("#/sessions")).toBeLessThan(hashes.indexOf("#/me"));
        expect(visibleNav([])).toEqual([]);
    });

    test("defaultHash 는 첫 허용 항목, 없으면 #/me 다", () => {
        expect(defaultHash(SUPERUSER_SECTIONS)).toBe("#/status");
        expect(defaultHash(["tunnels", "audit", "me", "sessions"])).toBe("#/tunnels");
        // U4-06: Audit log 가 NAV 에 들어와 첫 허용 항목이 바뀐다(defaultHash 의 정의 그대로다).
        expect(defaultHash(["audit", "me"])).toBe("#/audit");
        expect(defaultHash([])).toBe("#/me");
    });
});

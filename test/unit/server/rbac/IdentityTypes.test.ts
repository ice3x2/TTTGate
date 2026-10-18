import {
    createSystemGroups,
    DEFAULT_GROUP_ATTRIBUTES,
    newGroupId,
    newUserId,
    validateGroupAttributes,
    validatePassword,
    validateUsername
} from "../../../../src/server/rbac/IdentityTypes";

jest.setTimeout(15_000);

describe("IdentityTypes.validateUsername", () => {
    it("trims and lowercases a valid username", () => {
        expect(validateUsername("Admin")).toEqual({success: true, value: "admin"});
    });

    it.each([
        ["ab"],
        ["a".repeat(33)],
        ["a b"],
        ["한글"],
        [1234]
    ])("rejects invalid username %p", (value) => {
        const result = validateUsername(value as unknown);
        expect(result.success).toBe(false);
        expect((result as {status: number}).status).toBe(422);
        expect((result as {code: string}).code).toBe("username_invalid");
    });
});

describe("IdentityTypes.validatePassword", () => {
    it("rejects a password shorter than the minimum length", () => {
        const result = validatePassword("1234567");
        expect(result.success).toBe(false);
        expect((result as {code: string}).code).toBe("password_too_short");
    });

    it("accepts a password at the minimum length", () => {
        expect(validatePassword("12345678")).toEqual({success: true, value: "12345678"});
    });
});

describe("IdentityTypes.validateGroupAttributes", () => {
    it("#141 max_tunnel_duration_ms 는 10년을 넘지 못한다", () => {
        const tenYears = 10 * 365 * 86_400_000;
        expect(validateGroupAttributes({max_tunnel_duration_ms: tenYears}, DEFAULT_GROUP_ATTRIBUTES).success).toBe(true);
        expect(validateGroupAttributes({max_tunnel_duration_ms: tenYears + 1}, DEFAULT_GROUP_ATTRIBUTES))
            .toMatchObject({success: false, code: "attribute_int_invalid"});
    });

    it("returns a deep-equal copy of the base attributes when the patch is empty", () => {
        const result = validateGroupAttributes({}, DEFAULT_GROUP_ATTRIBUTES);
        expect(result.success).toBe(true);
        expect((result as {value: unknown}).value).toEqual(DEFAULT_GROUP_ATTRIBUTES);
    });

    it.each([
        [{tunnel_crud: "admin"}, "attribute_enum_invalid"],
        [{max_tunnel_count: -1}, "attribute_int_invalid"],
        [{max_tunnel_count: 1.5}, "attribute_int_invalid"],
        [{allowed_port_range: [{from: 20, to: 10}]}, "port_range_invalid"],
        [{allowed_port_range: [{from: 0, to: 1}]}, "port_range_invalid"],
        [{allowed_port_range: [{from: 1, to: 70000}]}, "port_range_invalid"],
        [{allowed_trusted_clients: ["*"]}, "trusted_clients_invalid"],
        [{unknown: 1}, "attributes_unknown_key"]
    ])("rejects patch %p with code %p", (patch, expectedCode) => {
        const result = validateGroupAttributes(patch, DEFAULT_GROUP_ATTRIBUTES);
        expect(result.success).toBe(false);
        expect((result as {code: string}).code).toBe(expectedCode);
    });

    it("rejects rewrite permissions enabled without HTTP_REWRITE in allowed_protocols", () => {
        const result = validateGroupAttributes(
            {http_tunnel_rewrite_permissions: {cors: true, host: false, header: false, body: false}},
            DEFAULT_GROUP_ATTRIBUTES
        );
        expect(result.success).toBe(false);
        expect((result as {code: string}).code).toBe("rewrite_requires_http_rewrite");
    });

    it("rejects HTTP_REWRITE without HTTP or HTTPS in allowed_protocols", () => {
        const result = validateGroupAttributes({allowed_protocols: ["HTTP_REWRITE"]}, DEFAULT_GROUP_ATTRIBUTES);
        expect(result.success).toBe(false);
        expect((result as {code: string}).code).toBe("http_rewrite_requires_http");
    });

    it("accepts HTTP_REWRITE together with HTTP and full rewrite permissions", () => {
        const result = validateGroupAttributes(
            {
                allowed_protocols: ["HTTP", "HTTP_REWRITE"],
                http_tunnel_rewrite_permissions: {cors: true, host: true, header: true, body: true}
            },
            DEFAULT_GROUP_ATTRIBUTES
        );
        expect(result.success).toBe(true);
    });

    it("accepts overlapping port ranges", () => {
        const result = validateGroupAttributes(
            {allowed_port_range: [{from: 1, to: 100}, {from: 50, to: 200}]},
            DEFAULT_GROUP_ATTRIBUTES
        );
        expect(result.success).toBe(true);
    });
});

describe("IdentityTypes.createSystemGroups", () => {
    it("creates the superuser and default system groups", () => {
        const [superuserGroup, defaultGroup] = createSystemGroups();
        expect([superuserGroup.id, defaultGroup.id]).toEqual(["system:superuser", "default"]);
        expect(superuserGroup.system).toBe(true);
        expect(defaultGroup.system).toBe(true);
    });
});

describe("IdentityTypes id generators", () => {
    it("generates ids matching the expected shape", () => {
        expect(newUserId()).toMatch(/^u_[0-9a-f]{16}$/);
        expect(newGroupId()).toMatch(/^g_[0-9a-f]{16}$/);
    });
});

import fs from "fs";
import Path from "path";
import YAML from "yaml";

describe("release documentation and sample config alignment", () => {
    it("ships runtime sample configs that match the secure-by-default runtime policy", () => {
        const serverSample = YAML.parse(fs.readFileSync(Path.join(process.cwd(), "config", "server.sample.yaml"), {encoding: "utf-8"})) as any;
        const clientSample = YAML.parse(fs.readFileSync(Path.join(process.cwd(), "config", "client.sample.yaml"), {encoding: "utf-8"})) as any;

        expect(serverSample).toMatchObject({
            adminBindHost: "127.0.0.1",
            adminTls: true,
            controlProtocolMode: "mixed",
            allowLegacyControlAuth: false,
            logLevel: "info"
        });
        expect(serverSample.trustedClients?.[0]).toMatchObject({
            clientId: "client-a",
            displayName: "Client A"
        });
        expect(serverSample.tunnelingOptions?.[0]?.httpOption?.replaceAccessControlAllowOrigin).toBe(false);

        expect(clientSample).toMatchObject({
            tls: true,
            clientId: "client-a",
            allowLegacyFallback: false,
            allowInsecureTls: false
        });
        // #210: displayName 은 name 의 폐기 예정 별칭이다. 샘플에 두면 시작할 때마다 경고가 난다.
        expect(clientSample.displayName).toBeUndefined();
    });

    it("documents the runtime config paths, bootstrap token, and rollout policy in README", () => {
        const readme = fs.readFileSync(Path.join(process.cwd(), "README.md"), {encoding: "utf-8"});

        expect(fs.existsSync(Path.join(process.cwd(), "config.yaml"))).toBe(false);
        expect(readme).toContain("config/server.yaml");
        expect(readme).toContain("config/client.yaml");
        expect(readme).toContain("config/.bootstrap-token");
        expect(readme).toContain("replaceAccessControlAllowOrigin");
        expect(readme).toContain("allowLegacyControlAuth");
        // #267: 로그 레벨 설정과 허용값을 README 에 적는다.
        expect(readme).toMatch(/`logLevel`[^\n]*`error`, `warn`, `info` \(default\) and `debug`/);
        expect(readme).toContain("clientId");
        expect(readme).toContain("clientSecret");
    });
});

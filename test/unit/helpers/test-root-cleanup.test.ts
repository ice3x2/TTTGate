import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Environment from "../../../src/Environment";
import ServerOptionStore from "../../../src/server/ServerOptionStore";
import {applyTestRoot, cleanupTestRoot, createTestRoot} from "../../helpers/runtime";

// #264 AC-2 — 테스트가 끝난 뒤에도 돌던 서버 작업(시간 초과로 먼저 끝난 요청의 처리 등)이 설정을 쓰면,
// 정리 뒤의 루트가 저장소(cwd)라 저장소 config/ 에 server.yaml·identity.yaml 이 생겼다. 정리 뒤 루트는 저장소 밖이어야 한다.
describe("cleanupTestRoot", () => {
    test("leaves the runtime root outside the repository so late writes cannot reach the repository config", async () => {
        const root = await createTestRoot("cleanup-root");
        applyTestRoot(root.rootDir);
        await cleanupTestRoot(root);
        const repo = path.resolve(process.cwd());
        const configDir = path.resolve(Environment.path.configDir);
        expect(configDir.startsWith(repo + path.sep)).toBe(false);
        expect(configDir.startsWith(path.resolve(os.tmpdir()))).toBe(true);
    });

    test("a store created after cleanup writes its default config outside the repository", async () => {
        const root = await createTestRoot("cleanup-late-write");
        applyTestRoot(root.rootDir);
        await cleanupTestRoot(root);
        // 개발 중 저장소에 server.yaml 이 이미 있어도 회귀를 잡도록, 있으면 크기와 수정 시각이 그대로인지 본다.
        const repoConfig = path.join(process.cwd(), "config", "server.yaml");
        const stamp = () => fs.existsSync(repoConfig) ? (({size, mtimeMs}) => ({size, mtimeMs}))(fs.statSync(repoConfig)) : undefined;
        const before = stamp();
        void ServerOptionStore.instance;
        expect(fs.existsSync(path.join(Environment.path.configDir, "server.yaml"))).toBe(true);
        expect(stamp()).toEqual(before);
        await cleanupTestRoot();
    });
});

import Environment from "../../../../src/Environment";
import SessionStore, {BOOTSTRAP_TOKEN_FILE_NAME} from "../../../../src/server/admin/SessionStore";
import {ClockRngProvider} from "../../../../src/util/ClockRng";
import File from "../../../../src/util/File";
import Files from "../../../../src/util/Files";
import {createFakeClockRng, FakeClockRng} from "../../../helpers/clockRng";
import {applyTestRoot, cleanupTestRoot, createTestRoot, TestRoot} from "../../../helpers/runtime";

describe("SessionStore baseline behavior", () => {
    let testRoot: TestRoot;
    let fakeClock: FakeClockRng;

    beforeEach(async () => {
        testRoot = await createTestRoot("session-store");
        applyTestRoot(testRoot.rootDir);
        fakeClock = createFakeClockRng(1_700_000_000_000, [0.125]);
        ClockRngProvider.configure(fakeClock);
    });

    afterEach(async () => {
        await cleanupTestRoot(testRoot);
    });

    it("persists the first login key and validates issued sessions", async () => {
        const store = SessionStore.instance;
        const bootstrapToken = Files.toStringSync(new File(Environment.path.configDir, BOOTSTRAP_TOKEN_FILE_NAME))?.trim() ?? "";

        expect(await store.isEmptyKey()).toBe(true);
        expect(await store.login("supersecret1", bootstrapToken)).toBe(true);
        expect(await store.isEmptyKey()).toBe(false);

        const sessionKey = await store.newSession();
        const keyFile = new File(Environment.path.configDir, ".key");

        expect(keyFile.isFile()).toBe(true);
        expect(sessionKey).toMatch(/^[a-f0-9]{128}$/);
        expect(await store.isSessionValid([sessionKey])).toBe(true);
    });

    it("expires sessions when the clock advances past the default timeout", async () => {
        const store = SessionStore.instance;
        const bootstrapToken = Files.toStringSync(new File(Environment.path.configDir, BOOTSTRAP_TOKEN_FILE_NAME))?.trim() ?? "";
        await store.login("supersecret1", bootstrapToken);

        const sessionKey = await store.newSession();
        fakeClock.advance((12 * 60 * 60 * 1000) + 1);

        expect(await store.isSessionValid([sessionKey])).toBe(false);
    });
});

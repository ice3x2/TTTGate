import {once} from "events";
import {setTimeout as delay} from "timers/promises";
import {withConfigurationServer} from "./configuration-revision-fixture";

test("a second admin snapshot waits for the complete committed runtime result", async () => {
    await withConfigurationServer(async ({apis, tunnel, request, snapshot}) => {
        const read = await snapshot();
        const apply = tunnel.applyServerOption;
        let entered!: () => void;
        const atRuntime = new Promise<void>(resolve => { entered = resolve; });
        let release!: () => void;
        const pause = new Promise<void>(resolve => { release = resolve; });
        // Explicit scheduling boundary; the actual runtime apply is delegated.
        tunnel.applyServerOption = async (...args: any[]) => { entered(); await pause; return apply.apply(tunnel, args); };
        let save: Promise<any> | undefined;
        let following: Promise<any> | undefined;
        try {
            save = request("POST", "/api/serverOption", {...read.serverOption, adminBindHost: "::1", expectedRevision: read.revisionState.currentRevision});
            await atRuntime;
            let resolved = false;
            const received = once(apis[1]._server, "request");
            following = request("GET", "/api/serverOption", undefined, 1).then((result: any) => { resolved = true; return result; });
            await received;
            await delay(30);
            const exposedBeforeApply = resolved;
            release();
            expect((await save).statusCode).toBe(200);
            expect((await following).statusCode).toBe(200);
            expect(exposedBeforeApply).toBe(false);
        } finally {
            release(); await Promise.allSettled([save, following]); tunnel.applyServerOption = apply;
        }
    });
}, 45_000);

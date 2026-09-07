import {withConfigurationServer} from "../component/server/admin/configuration-revision-fixture";
import {writeWebFixture} from "../helpers/runtime";
import {startAdminBrowser} from "../helpers/adminBrowser";

jest.setTimeout(60_000);

test("an editor retains its read revision when another controller read refreshes the cache", async () => {
    await withConfigurationServer(async ({root, ports, request, snapshot}: any) => {
        const app = await startAdminBrowser();
        try {
            await writeWebFixture(root.rootDir, "index.html", `<script type="module" src="${app.url}/test/requests.ts"></script>`);
            await app.page.goto(`http://127.0.0.1:${ports[0]}`);
            await app.page.waitForFunction(() => !!(window as any).adminControllers);
            const login = await app.page.evaluate(async () => {
                const res = await fetch("/api/login", {method: "POST", headers: {"Content-Type": "application/json"},
                    body: JSON.stringify({key: "revision-password"})});
                return res.status;
            });
            expect(login).toBe(200);
            const initial = await snapshot();
            const held = await app.page.evaluate(async () => {
                const draft = await (window as any).adminControllers.server.getServerOption();
                (window as any).heldDraft = draft;
                return draft;
            });
            const changed = await request("POST", "/api/serverOption", {...initial.serverOption,
                adminBindHost: "::1", expectedRevision: initial.revisionState.currentRevision});
            expect(changed.statusCode).toBe(200);
            const sent: any[] = [];
            app.page.on("request", (req) => {
                if(req.method() === "POST" && new URL(req.url()).pathname === "/api/serverOption") sent.push(req.postDataJSON());
            });
            const outcome = await app.page.evaluate(async () => {
                const controller = (window as any).adminControllers.server;
                const fresh = await controller.getServerOption();
                const draft = (window as any).heldDraft;
                const result = await controller.updateServerOption(draft.value ?? draft, draft.revision);
                return {fresh, heldRevision: draft.revision, result};
            });
            expect(held.revision).toBe(initial.revisionState.currentRevision);
            expect(held.value).toEqual(initial.serverOption);
            expect(outcome.fresh.revision).toBe(held.revision + 1);
            expect(outcome.heldRevision).toBe(held.revision);
            expect(sent).toHaveLength(1);
            expect(sent[0].expectedRevision).toBe(held.revision);
            expect(outcome.result.success).toBe(false);
            expect((await snapshot()).serverOption.adminBindHost).toBe("::1");
        } finally { await app.close(); }
    });
});

import SessionStore from "../../src/server/admin/SessionStore";
import {startAdminBrowser} from "../helpers/adminBrowser";

test("real admin component mounts, responds to a click and reports browser errors", async () => {
    const app = await startAdminBrowser();
    try {
        await app.page.goto(`${app.url}/test/fixture.html`);
        const button = app.page.getByRole("button", {name: "Dismiss test alert"});
        await button.waitFor({state: "visible"});
        await button.click();
        await button.waitFor({state: "hidden"});
        expect(app.errors).toEqual([]);
    } finally {
        await app.close();
    }
}, 30_000);

test("browser login hash agrees with the server legacy credential contract", async () => {
    const app = await startAdminBrowser();
    try {
        await app.page.goto(`${app.url}/test/fixture.html`);
        await app.page.waitForFunction(() => typeof (window as any).hashPassword === "function");
        for (const password of [" password1! ", "관리자🙂암호123!", ""]) {
            const actual = await app.page.evaluate((value: string) => (window as any).hashPassword(value), password);
            const expected = (SessionStore.prototype as any).hashPassword(password);
            expect(actual).toBe(expected);
            expect(actual).toMatch(/^[a-f0-9]{128}$/);
        }
        expect(app.errors).toEqual([]);
    } finally {
        await app.close();
    }
}, 30_000);

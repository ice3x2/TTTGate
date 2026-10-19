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


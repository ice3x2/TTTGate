import {startAdminBrowser, ADMIN_BROWSER_TEST_TIMEOUT_MS} from "../helpers/adminBrowser";

// 앱 기동 예산보다 짧으면 부하에서 helper 의 진단 대신 jest 시간 초과로 끝난다(#273).
jest.setTimeout(ADMIN_BROWSER_TEST_TIMEOUT_MS);

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
}, ADMIN_BROWSER_TEST_TIMEOUT_MS);


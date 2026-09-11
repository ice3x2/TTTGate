import {startAdminBrowser} from "../helpers/adminBrowser";

test("bundled fonts load without any Google Fonts network request", async () => {
    const app = await startAdminBrowser();
    const requestedUrls: string[] = [];
    app.page.on("request", (request) => { requestedUrls.push(request.url()); });
    try {
        await app.page.goto(`${app.url}/test/fonts-fixture.html`);
        const loadedFamilies = await app.page.evaluate(async () => {
            await Promise.all([
                document.fonts.load('600 16px "Noto Serif"'),
                document.fonts.load('500 16px "Noto Sans"'),
                document.fonts.load('400 16px "JetBrains Mono"'),
            ]);
            return [...document.fonts].filter((f) => f.status === "loaded").map((f) => f.family);
        });
        expect(loadedFamilies).toEqual(expect.arrayContaining(["Noto Serif", "Noto Sans", "JetBrains Mono"]));
        expect(requestedUrls.some((url) => url.includes("fonts.googleapis.com"))).toBe(false);
        expect(requestedUrls.some((url) => url.includes("fonts.gstatic.com"))).toBe(false);
        expect(app.errors).toEqual([]);
    } finally {
        await app.close();
    }
}, 30_000);

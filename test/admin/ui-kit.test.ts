import {startAdminBrowser} from "../helpers/adminBrowser";

test("Button 클릭이 count 를 증가시키고, disabled 버튼은 비활성 상태다", async () => {
    const app = await startAdminBrowser();
    try {
        await app.page.setViewportSize({width: 400, height: 800});
        await app.page.goto(`${app.url}/test/ui-fixture.html`);
        const countButton = app.page.getByRole("button", {name: "Count"});
        await countButton.click();
        await countButton.click();
        await countButton.click();
        expect(await app.page.locator("#count").textContent()).toBe("3");
        const disabledButton = app.page.getByRole("button", {name: "Disabled"});
        expect(await disabledButton.isDisabled()).toBe(true);
        expect(await app.page.locator(".btn[disabled]").count()).toBeGreaterThan(0);
        expect(app.errors).toEqual([]);
    } finally {
        await app.close();
    }
}, 30_000);

test("TextInput 입력이 echo 되고 label 로 접근할 수 있다", async () => {
    const app = await startAdminBrowser();
    try {
        await app.page.setViewportSize({width: 400, height: 800});
        await app.page.goto(`${app.url}/test/ui-fixture.html`);
        await app.page.locator("#text-input").fill("hello");
        expect(await app.page.locator("#text-echo").textContent()).toBe("hello");
        expect(await app.page.getByLabel("Text", {exact: true}).evaluate((el) => el.id)).toBe("text-input");
        expect(app.errors).toEqual([]);
    } finally {
        await app.close();
    }
}, 30_000);

test("NumberInput 이 값을 echo 하고 초과 값에 에러 메시지를 보이며 빈 값은 null 이다", async () => {
    const app = await startAdminBrowser();
    try {
        await app.page.setViewportSize({width: 400, height: 800});
        await app.page.goto(`${app.url}/test/ui-fixture.html`);
        await app.page.locator("#number-input").fill("42");
        expect(await app.page.locator("#number-echo").textContent()).toBe("42");
        expect(await app.page.locator(".err-msg").textContent()).toContain("Too large");
        await app.page.locator("#number-input").fill("");
        expect(await app.page.locator("#number-echo").textContent()).toBe("null");
        expect(app.errors).toEqual([]);
    } finally {
        await app.close();
    }
}, 30_000);

test("Select 에서 옵션을 고르면 echo 된다", async () => {
    const app = await startAdminBrowser();
    try {
        await app.page.setViewportSize({width: 400, height: 800});
        await app.page.goto(`${app.url}/test/ui-fixture.html`);
        await app.page.locator("#select").selectOption("b");
        expect(await app.page.locator("#select-echo").textContent()).toBe("b");
        expect(app.errors).toEqual([]);
    } finally {
        await app.close();
    }
}, 30_000);

test("Checkbox 를 체크/해제하면 echo 되고 label 로 접근할 수 있다", async () => {
    const app = await startAdminBrowser();
    try {
        await app.page.setViewportSize({width: 400, height: 800});
        await app.page.goto(`${app.url}/test/ui-fixture.html`);
        const checkbox = app.page.locator("#checkbox");
        await checkbox.check();
        expect(await app.page.locator("#checkbox-echo").textContent()).toBe("true");
        await checkbox.uncheck();
        expect(await app.page.locator("#checkbox-echo").textContent()).toBe("false");
        expect(await app.page.getByLabel("Fixture checkbox").evaluate((el) => el.id)).toBe("checkbox");
        expect(app.errors).toEqual([]);
    } finally {
        await app.close();
    }
}, 30_000);

test("Switch 를 클릭하면 aria-checked 와 echo, 이벤트 카운트가 갱신된다", async () => {
    const app = await startAdminBrowser();
    try {
        await app.page.setViewportSize({width: 400, height: 800});
        await app.page.goto(`${app.url}/test/ui-fixture.html`);
        const toggle = app.page.getByRole("switch", {name: "Fixture switch"});
        expect(await toggle.getAttribute("aria-checked")).toBe("false");
        await toggle.click();
        expect(await toggle.getAttribute("aria-checked")).toBe("true");
        expect(await app.page.locator("#switch-echo").textContent()).toBe("true");
        expect(await app.page.locator("#switch-events").textContent()).toBe("1");
        expect(await toggle.evaluate((el) => el.classList.contains("on"))).toBe(true);
        expect(app.errors).toEqual([]);
    } finally {
        await app.close();
    }
}, 30_000);

test("Card 는 label 과 body 를 보이고, ticked+compact 조합이 1개다", async () => {
    const app = await startAdminBrowser();
    try {
        await app.page.setViewportSize({width: 400, height: 800});
        await app.page.goto(`${app.url}/test/ui-fixture.html`);
        await app.page.getByText("Fixture card").waitFor({state: "visible"});
        await app.page.getByText("Card body").waitFor({state: "visible"});
        expect(await app.page.locator(".card.ticked.compact").count()).toBe(1);
        expect(app.errors).toEqual([]);
    } finally {
        await app.close();
    }
}, 30_000);

test("Chip 과 Badge 가 올바른 tone 과 텍스트로 렌더링된다", async () => {
    const app = await startAdminBrowser();
    try {
        await app.page.setViewportSize({width: 400, height: 800});
        await app.page.goto(`${app.url}/test/ui-fixture.html`);
        expect(await app.page.locator(".chip.mono").textContent()).toBe("1.0.11b");
        expect(await app.page.locator(".badge").count()).toBe(6);
        expect(await app.page.locator(".badge.pulse").textContent()).toBe("PULSE");
        expect(app.errors).toEqual([]);
    } finally {
        await app.close();
    }
}, 30_000);

test("모든 입력과 select 는 뷰포트 폭을 넘지 않고 가로 스크롤이 없다", async () => {
    const app = await startAdminBrowser();
    try {
        await app.page.setViewportSize({width: 400, height: 800});
        await app.page.goto(`${app.url}/test/ui-fixture.html`);
        const widths = await app.page.locator(".input, .select").evaluateAll(
            (elements) => elements.map((el) => el.getBoundingClientRect().width),
        );
        expect(widths.length).toBeGreaterThan(0);
        for(const width of widths) expect(width).toBeLessThanOrEqual(400);
        const noHorizontalScroll = await app.page.evaluate(
            () => document.documentElement.scrollWidth === document.documentElement.clientWidth,
        );
        expect(noHorizontalScroll).toBe(true);
        expect(app.errors).toEqual([]);
    } finally {
        await app.close();
    }
}, 30_000);

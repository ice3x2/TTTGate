import fs from "fs";
import path from "path";
import type {Locator, Page} from "playwright";
import {startAdminApp} from "../helpers/adminApp";

const root = path.resolve(__dirname, "../..");

const sysinfoDialog = (page: Page): Locator => page.getByRole("dialog", {name: "System info"});

const CPU_MESSAGE = /^\d+(\.\d+)?\/\d+(\.\d+)?%$/;
const SIZE = String.raw`\d+(\.\d+)?(B|KiB|MiB|GiB|TiB)`;
const MEMORY_MESSAGE = new RegExp(`^${SIZE}/${SIZE}$`);

// 게이지는 첫 폴링 응답이 도착해야 나타난다.
const waitForGauges = (page: Page) =>
    page.waitForFunction(() => document.querySelectorAll(".gauge-title").length === 4, undefined, {timeout: 15_000});

// SysMonitor 는 첫 표본에서 cpu.total 을 계산하지 못해 null 을 실어 보낸다(서버 쪽 성질).
// 화면은 서버가 준 값을 그대로 그리므로, 수치가 실린 표본이 올 때까지 기다렸다가 형식을 본다.
const waitForCpuMessage = (page: Page) =>
    page.waitForFunction((pattern) => new RegExp(pattern).test(document.querySelector(".gauge-msg")?.textContent ?? ""),
        CPU_MESSAGE.source, {timeout: 15_000});

test("옛 ServerStatusLayout 과 SysinfoPopup 이 layout 에 남아 있지 않다", () => {
    expect(fs.existsSync(path.join(root, "admin/src/layout/ServerStatusLayout.svelte"))).toBe(false);
    expect(fs.existsSync(path.join(root, "admin/src/layout/SysinfoPopup.svelte"))).toBe(false);
});

test("상태 화면이 게이지 4개와 가동 시간을 실제 수치로 그린다", async () => {
    const app = await startAdminApp();
    try {
        await waitForGauges(app.page);
        expect(await app.page.locator(".gauge-title").allTextContents()).toEqual(["CPU", "Memory", "Heap", "Buffer"]);

        // 봉투를 푼 값이 실제로 들어왔는지 수치 형식으로 확인한다.
        await waitForCpuMessage(app.page);
        expect(await app.page.locator(".gauge-msg").first().textContent()).toMatch(CPU_MESSAGE);
        expect(await app.page.locator(".gauge-msg").nth(1).textContent()).toMatch(MEMORY_MESSAGE);
        expect(await app.page.locator(".status-uptime").textContent())
            .toMatch(/^\d+d \d+h \d+m \d+s$/);

        expect(app.errors).toEqual([]);
    } finally {
        await app.close();
    }
}, 60_000);

test("INFO 를 누르면 시스템 정보 모달이 세 절을 보여주고 OK 로 닫힌다", async () => {
    const app = await startAdminApp();
    try {
        await waitForGauges(app.page);
        await app.page.getByRole("button", {name: "INFO", exact: true}).click();

        const dialog = sysinfoDialog(app.page);
        await dialog.waitFor({state: "visible", timeout: 10_000});
        for(const heading of ["HW Info", "OS Info", "Network"]) {
            await dialog.getByRole("heading", {name: heading, exact: true}).waitFor({state: "visible", timeout: 10_000});
        }

        await dialog.getByRole("button", {name: "OK", exact: true}).click();
        await dialog.waitFor({state: "detached", timeout: 10_000});

        expect(app.errors).toEqual([]);
    } finally {
        await app.close();
    }
}, 60_000);

test("클라이언트 카드가 스텁 값을 그리고 카드를 누르면 그 클라이언트의 시스템 정보가 열린다", async () => {
    const app = await startAdminApp();
    try {
        await app.page.waitForFunction(() => document.querySelectorAll(".client-list > li").length === 1,
            undefined, {timeout: 15_000});

        for(const text of ["ID: 1", "client-a", "127.0.0.1:50000", "Active session"]) {
            await app.page.getByText(text, {exact: true}).waitFor({state: "visible", timeout: 10_000});
        }
        // dt 순서는 Address, Uptime, Active session 이므로 두 번째 dd 가 가동 시간이다.
        expect(await app.page.locator(".client-meta dd").nth(1).textContent()).toBe("0d 0h 1m 5s");

        await app.page.getByRole("button", {name: "Client 1 details", exact: true}).click();
        const dialog = sysinfoDialog(app.page);
        await dialog.waitFor({state: "visible", timeout: 10_000});
        await dialog.getByText("Fixture CPU", {exact: true}).waitFor({state: "visible", timeout: 10_000});
        await dialog.getByText("eth0", {exact: true}).waitFor({state: "visible", timeout: 10_000});

        await dialog.getByRole("button", {name: "OK", exact: true}).click();
        await dialog.waitFor({state: "detached", timeout: 10_000});

        expect(await app.calls()).toContainEqual({method: "getClientSysInfo", args: [1]});
        expect(app.errors).toEqual([]);
    } finally {
        await app.close();
    }
}, 60_000);

test("상태 화면은 1초마다 다시 읽고 화면을 떠나면 폴링을 멈춘다", async () => {
    const app = await startAdminApp();
    try {
        let requests = 0;
        app.page.on("request", (request) => {
            if(new URL(request.url()).pathname === "/api/sysUsage") requests++;
        });
        await waitForGauges(app.page);

        const beforePolling = requests;
        await app.page.waitForTimeout(2_000);
        expect(requests - beforePolling).toBeGreaterThanOrEqual(2);

        await app.page.evaluate(() => { location.hash = "#/server"; });
        await app.page.waitForFunction(() => location.hash === "#/server", undefined, {timeout: 10_000});
        // 전환 직전에 이미 발사된 요청이 집계에 섞이지 않도록 잠깐 둔 뒤부터 센다.
        await app.page.waitForTimeout(300);

        const afterLeaving = requests;
        await app.page.waitForTimeout(1_500);
        expect(requests - afterLeaving).toBe(0);

        expect(app.errors).toEqual([]);
    } finally {
        await app.close();
    }
}, 60_000);

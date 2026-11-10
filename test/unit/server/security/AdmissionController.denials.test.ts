import {AdmissionController} from "../../../../src/server/security/AdmissionController";
import {ConcurrencyLimiter} from "../../../../src/server/security/ConcurrencyLimiter";

// #327 REQ-1·2·4: 모든 거절은 한 곳에서 센다. 건수는 프로세스 수명 동안 누적하고, 최근 200건은 메모리에 둔다.
const TUNNEL_1 = {kind: "tunnel", port: 1, protocol: "tcp"} as const;
const RATE_LIMIT = {enabled: true, windowMs: 1000, maxConnections: 1, banMs: 1000};

const deniedConcurrency = {
    decide: () => ({decision: {allowed: false, reason: "concurrency-limit"}})
} as unknown as ConcurrencyLimiter;

describe("AdmissionController denial records (#327)", () => {
    beforeEach(() => AdmissionController.resetForTest());
    afterEach(() => AdmissionController.resetForTest());

    it("AC-1 counts each of the five reasons on a tunnel port, and the admin geo denial separately", () => {
        const controller = AdmissionController.instance;
        controller.configureTunnel({forwardPort: 1, rateLimit: RATE_LIMIT});
        controller.blocklist.configure([{address: "9.9.9.9", port: 1, note: "", createdAt: 0, createdBy: ""}]);
        expect(controller.admit(TUNNEL_1, "9.9.9.9", 0)).toMatchObject({reason: "ip-blocklist"});
        controller.admit(TUNNEL_1, "1.1.1.1", 0);
        expect(controller.admit(TUNNEL_1, "1.1.1.1", 1)).toMatchObject({reason: "rate-limit-exceeded"});
        expect(controller.admit(TUNNEL_1, "1.1.1.1", 2)).toMatchObject({reason: "rate-limit-ban"});
        controller.attachConcurrency(deniedConcurrency);
        expect(controller.admit(TUNNEL_1, "2.2.2.2", 3)).toMatchObject({reason: "concurrency-limit"});
        controller.attachConcurrency(null);
        controller.configureGeo({mode: "deny", countries: [], applyToAdmin: true, unknownPolicy: "deny"});
        expect(controller.admit(TUNNEL_1, "127.0.0.1", 4)).toMatchObject({reason: "geo-deny"});
        expect(controller.admit({kind: "admin"}, "127.0.0.1", 5)).toMatchObject({reason: "geo-deny"});

        expect(controller.snapshot()).toEqual({
            ports: {"1": {rejectedGeo: 1, rejectedBlocklist: 1, rejectedBans: 1, rejectedExceeded: 1, rejectedConcurrency: 1, rejectedActivatorIp: 0, bannedIps: 1}},
            admin: {rejectedGeo: 1}
        });
    });

    it("AC-1b lists a port without a rate limit once it has a denial", () => {
        const controller = AdmissionController.instance;
        controller.configureTunnel({forwardPort: 7, rateLimit: undefined});
        controller.configureGeo({mode: "deny", countries: [], applyToAdmin: false, unknownPolicy: "deny"});
        controller.admit({kind: "tunnel", port: 7, protocol: "tcp"}, "127.0.0.1", 0);

        expect(controller.snapshot().ports["7"]).toEqual({rejectedGeo: 1, rejectedBlocklist: 0, rejectedBans: 0,
            rejectedExceeded: 0, rejectedConcurrency: 0, rejectedActivatorIp: 0, bannedIps: 0});
    });

    it("AC-1c keeps the counts after the tunnel is reconfigured or released, also for the tunnel status counts", () => {
        const controller = AdmissionController.instance;
        controller.configureTunnel({forwardPort: 1, rateLimit: RATE_LIMIT});
        controller.admit(TUNNEL_1, "1.1.1.1", 0);
        controller.admit(TUNNEL_1, "1.1.1.1", 1);
        controller.configureGeo({mode: "deny", countries: [], applyToAdmin: false, unknownPolicy: "deny"});
        controller.admit(TUNNEL_1, "127.0.0.1", 2);

        controller.configureTunnel({forwardPort: 1, rateLimit: RATE_LIMIT});
        controller.releaseTunnel(1);

        expect(controller.snapshot().ports["1"]).toMatchObject({rejectedExceeded: 1, rejectedGeo: 1});
        expect(controller.denials(1)).toEqual({geo: 1, rateLimit: 1});
    });

    it("AC-2 keeps the latest 200 denials, newest first", () => {
        const controller = AdmissionController.instance;
        controller.blocklist.configure([{address: "9.9.9.9", port: null, note: "", createdAt: 0, createdBy: ""}]);
        for(let now = 0; now < 201; now++) controller.admit(TUNNEL_1, "9.9.9.9", now);
        controller.admit({kind: "tunnel", port: 1, protocol: "tcp"}, "::ffff:9.9.9.9", 500);

        const recent = controller.recentDenials();
        expect(recent).toHaveLength(200);
        expect(recent[0]).toEqual({at: 500, ip: "9.9.9.9", scope: 1, reason: "ip-blocklist"});
        expect(recent[1].at).toBe(200);
        expect(recent[199].at).toBe(2);
    });

    it("AC-2 records the admin scope as 'admin'", () => {
        const controller = AdmissionController.instance;
        controller.configureGeo({mode: "deny", countries: [], applyToAdmin: true, unknownPolicy: "deny"});
        controller.admit({kind: "admin"}, "127.0.0.1", 9);
        expect(controller.recentDenials()).toEqual([{at: 9, ip: "127.0.0.1", scope: "admin", reason: "geo-deny"}]);
    });
});

describe("denial country and file log wiring (#327)", () => {
    const fs = require("fs") as typeof import("fs");
    const os = require("os") as typeof import("os");
    const path = require("path") as typeof import("path");
    let dir: string;
    beforeEach(() => {
        AdmissionController.resetForTest();
        dir = fs.mkdtempSync(path.join(os.tmpdir(), "tttgate-admission-denial-"));
    });
    afterEach(async () => {
        jest.useRealTimers();
        // 파일 쓰기는 비동기다. 닫힐 때까지 기다린 뒤 임시 폴더를 지운다.
        await AdmissionController.instance.denialFileLog?.closeForTest();
        AdmissionController.resetForTest();
        fs.rmSync(dir, {recursive: true, force: true});
    });

    it("AC-2b shows countries only while the country filter is on, even after the database was loaded", () => {
        const geo = AdmissionController.instance.geo;
        expect(geo.countriesShown).toBe(false);
        expect(geo.displayCountry("8.8.8.8")).toBeUndefined();
        geo.configure({mode: "deny", countries: ["CN"], applyToAdmin: false, unknownPolicy: "allow"});
        expect(geo.countriesShown).toBe(true);
        expect(geo.displayCountry("8.8.8.8")).toBe("US");
        geo.configure({mode: "off", countries: [], applyToAdmin: false, unknownPolicy: "allow"});
        expect(geo.countriesShown).toBe(false);
        expect(geo.displayCountry("8.8.8.8")).toBeUndefined();
    });

    it("feeds every denial to the file log", () => {
        const controller = AdmissionController.instance;
        controller.configureDenialLog(dir, 20);
        controller.configureGeo({mode: "deny", countries: [], applyToAdmin: true, unknownPolicy: "deny"});
        controller.admit({kind: "admin"}, "127.0.0.1", 0);
        expect(controller.denialFileLog?.flushDue(60_000)).toBe(1);
    });

    it("AC-3b the periodic tick runs from configureDenialLog even without a tunnel", () => {
        jest.useFakeTimers();
        const controller = AdmissionController.instance;
        controller.configureDenialLog(dir, 20);
        const tick = jest.spyOn(controller.denialFileLog!, "tick").mockImplementation(() => {});
        jest.advanceTimersByTime(30_000);
        expect(tick).toHaveBeenCalledTimes(1);
    });

    it("AC-11 an unwritable log directory does not change admission results", async () => {
        // 쓸 수 없는 경로라 LogWriter 가 오류를 콘솔에 알린다. 예상된 출력이다.
        const consoleError = jest.spyOn(console, "error").mockImplementation(() => {});
        const decide = () => {
            const controller = AdmissionController.instance;
            controller.configureGeo({mode: "deny", countries: [], applyToAdmin: true, unknownPolicy: "deny"});
            return [controller.admit({kind: "admin"}, "127.0.0.1", 0), controller.admit({kind: "tunnel", port: 3, protocol: "tcp"}, "127.0.0.1", 1)];
        };
        const expected = decide();
        AdmissionController.resetForTest();
        const notADirectory = path.join(dir, "file");
        fs.writeFileSync(notADirectory, "");
        AdmissionController.instance.configureDenialLog(notADirectory, 20);
        expect(decide()).toEqual(expected);
        expect(() => AdmissionController.instance.denialFileLog?.tick(Date.now() + 3_600_000)).not.toThrow();
        await AdmissionController.instance.denialFileLog?.closeForTest();
        consoleError.mockRestore();
    });

    it("a later call with another directory writes there", () => {
        const controller = AdmissionController.instance;
        controller.configureDenialLog(dir, 20);
        const other = path.join(dir, "other");
        controller.configureDenialLog(other, 20);
        expect(controller.denialFileLog?.directory).toBe(other);
    });

    it("AC-6 retention zero keeps the file log off", () => {
        const controller = AdmissionController.instance;
        controller.configureDenialLog(dir, 0);
        expect(controller.denialFileLog?.enabled).toBe(false);
        controller.configureDenialLog(dir, 5);
        expect(controller.denialFileLog?.enabled).toBe(true);
    });
});

import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {spawnSync} from "child_process";

const root = path.resolve(__dirname, "../../..");
const script = path.join(root, "scripts/timing-safe-string-equal-bench.cjs");
const classifyMeasurements = (data: unknown) => require(script).classifyMeasurements(data);
const group = (early: number, late: number) => ({
    earlySamplesNs: Array(120).fill(early), lateSamplesNs: Array(120).fill(late),
});
const measurements = () => ({hexTarget: group(96, 100), hexNoise: group(100, 100),
    decodedBufferTarget: group(100, 100), bufferNoise: group(100, 100), earlyExit: group(10, 100)});
const impreciseGroup = () => ({earlySamplesNs: Array(120).fill(100),
    lateSamplesNs: [...Array(60).fill(70), ...Array(60).fill(140)]});

describe("timing experiment decision contract (measurement data fixtures)", () => {
    test("valid controls and target below seven percent pass", () => {
        expect(classifyMeasurements(measurements()).status).toBe("pass");
    });
    test("target at seven percent fails, without relaxing the threshold", () => {
        expect(classifyMeasurements({...measurements(), hexTarget: group(193, 207)}).status).toBe("fail");
    });
    test("retains the original mean denominator at the seven-percent boundary", () => {
        expect(classifyMeasurements({...measurements(), hexTarget: group(93.1, 100)}).status).toBe("fail");
    });
    test("noisy identical-input control is inconclusive", () => {
        expect(classifyMeasurements({...measurements(), hexNoise: group(90, 100)}).status).toBe("inconclusive");
    });
    test("insensitive early-exit positive control is inconclusive", () => {
        expect(classifyMeasurements({...measurements(), earlyExit: group(99, 100)}).status).toBe("inconclusive");
    });
    test("missing, incomplete or invalid samples cannot pass", () => {
        for(const invalid of [undefined, {}, {...measurements(), hexTarget: group(0, 0)},
            {...measurements(), hexTarget: {earlySamplesNs: [1], lateSamplesNs: [1]}},
            {...measurements(), hexNoise: group(Number.NaN, 100)}]) {
            expect(classifyMeasurements(invalid).status).toBe("inconclusive");
        }
    });
    test.each(["hexTarget", "decodedBufferTarget"])("imprecise %s cannot pass despite pooled bias below seven", (name) => {
        const result = classifyMeasurements({...measurements(), [name]: impreciseGroup()});
        expect(result.biasPercent[name]).toBeLessThan(7);
        expect(result.status).toBe("inconclusive");
        expect(result.statistics[name].blockMeansPercent).toHaveLength(12);
        expect(result.statistics[name].confidenceIntervalPercent.lower).toBeLessThan(-7);
        expect(result.statistics[name].confidenceIntervalPercent.upper).toBeGreaterThan(7);
    });
    test("decoded-buffer target threshold failure is retained independently of the hex target", () => {
        expect(classifyMeasurements({...measurements(), decodedBufferTarget: group(193, 207)}).status).toBe("fail");
    });
    test("a pooled target failure remains fail even when its interval is imprecise", () => {
        const uncertainFailure = {earlySamplesNs: Array(120).fill(100),
            lateSamplesNs: [...Array(60).fill(50), ...Array(60).fill(170)]};
        const result = classifyMeasurements({...measurements(), hexTarget: uncertainFailure});
        expect(result.biasPercent.hexTarget).toBeGreaterThanOrEqual(7);
        expect(result.statistics.hexTarget.confidenceIntervalPercent.lower).toBeLessThan(-7);
        expect(result.statistics.hexTarget.confidenceIntervalPercent.upper).toBeGreaterThan(7);
        expect(result.status).toBe("fail");
    });
    test.each(["hexNoise", "bufferNoise"])("imprecise %s invalidates the experiment", (name) => {
        expect(classifyMeasurements({...measurements(), [name]: impreciseGroup()}).status).toBe("inconclusive");
    });
    test("sensitivity must have a positive signed lower bound above seven", () => {
        expect(classifyMeasurements({...measurements(), earlyExit: group(100, 10)}).status).toBe("inconclusive");
    });
    test("uses twelve fixed ten-pair blocks and the preregistered t11 interval", () => {
        const data = measurements();
        data.hexTarget = {earlySamplesNs: Array(120).fill(100),
            lateSamplesNs: Array.from({length: 120}, (_, index) => index < 60 ? 100 : 102)};
        const stats = classifyMeasurements(data).statistics.hexTarget;
        expect(stats.blockMeansPercent.slice(0, 6)).toEqual(Array(6).fill(0));
        const difference = 2 / 101 * 100;
        for(const value of stats.blockMeansPercent.slice(6)) expect(value).toBeCloseTo(difference, 10);
        const mean = difference / 2;
        const margin = 2.2009851601 * mean / Math.sqrt(11);
        expect(stats.confidenceIntervalPercent.lower).toBeCloseTo(mean - margin, 9);
        expect(stats.confidenceIntervalPercent.upper).toBeCloseTo(mean + margin, 9);
    });
});

test("dedicated command is explicit and ordinary Jest no longer runs the seven-percent experiment", () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
    expect(pkg.scripts["test:timing"]).toBe("npm run build && node scripts/timing-safe-string-equal-bench.cjs");
    const unit = fs.readFileSync(path.join(root, "test/unit/util/req-04-timing-safe-string-equal.test.ts"), "utf8");
    expect(unit).not.toContain("process.hrtime.bigint()");
    expect(unit).not.toContain("test.skip");
});

test("missing conditions and instrumentation exit nonzero and retain distinct reports", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "tttgate-timing-"));
    try {
        for(const args of [[], ["--conditions", "test", "fixture;", "instrumentation", "intentionally", "enabled"]]) {
            const result = spawnSync(process.execPath, [script, "--output-dir", directory, ...args], {
                cwd: root, encoding: "utf8", timeout: 5000,
                env: {...process.env, COVERAGE: "1"},
            });
            expect(result.error).toBeUndefined();
            expect(result.status).toBe(2);
            expect(result.stdout).toContain("inconclusive");
        }
        const files = fs.readdirSync(directory);
        expect(files).toHaveLength(2);
        for(const file of files) {
            const report = JSON.parse(fs.readFileSync(path.join(directory, file), "utf8"));
            expect(report.status).toBe("inconclusive");
            expect(report.reason).toMatch(/conditions|instrumentation/);
            expect(report.node).toBe(process.version);
            if(report.conditions) expect(report.conditions).toBe("test fixture; instrumentation intentionally enabled");
            expect(report.iterations).toBe(10_000);
            expect(report.warmup).toBe(50_000);
            expect(report.samples).toBe(120);
            expect(report.order).toEqual(Array.from({length: 120}, (_, index) => index % 2 === 0 ? "AB" : "BA"));
            expect(report.groupOrder).toHaveLength(120);
            const groups = ["hexTarget", "hexNoise", "decodedBufferTarget", "bufferNoise", "earlyExit"];
            report.groupOrder.forEach((order: string[], index: number) => {
                const offset = index % groups.length;
                expect(order).toEqual([...groups.slice(offset), ...groups.slice(0, offset)]);
            });
            expect(report.precision).toEqual({blocks: 12, pairsPerBlock: 10, confidenceLevel: 0.95, tCritical: 2.2009851601});
        }
    } finally {
        fs.rmSync(directory, {recursive: true, force: true});
    }
}, 10_000);

test.each(["short require", "NODE_OPTIONS short require", "global coverage"])(
    "rejects actual %s instrumentation before entering the timing loop", (mode) => {
        const directory = fs.mkdtempSync(path.join(os.tmpdir(), "tttgate-timing-preload-"));
        try {
            const preload = path.join(directory, "preload.cjs");
            fs.writeFileSync(preload, [
                mode === "global coverage" ? "globalThis.__coverage__ = {}; process.execArgv.length = 0;" : "",
                // A regression in the guard must fail without running a timing experiment.
                "process.hrtime.bigint = () => { throw new Error('TIMING_MUST_NOT_RUN'); };",
            ].join("\n"));
            const environment = {...process.env};
            delete environment.COVERAGE;
            delete environment.NODE_V8_COVERAGE;
            delete environment.NODE_OPTIONS;
            const preloadArgs = mode === "NODE_OPTIONS short require" ? [] : ["-r", preload];
            if(mode === "NODE_OPTIONS short require") environment.NODE_OPTIONS = `-r "${preload.replace(/\\/g, "/")}"`;
            const result = spawnSync(process.execPath, [...preloadArgs, script,
                "--conditions", "guard regression; no measurement authorized", "--output-dir", directory], {
                cwd: root, encoding: "utf8", timeout: 5000, env: environment,
            });
            expect(result.error).toBeUndefined();
            expect({status: result.status, stderr: result.stderr}).toEqual({status: 2, stderr: ""});
            const summary = JSON.parse(result.stdout);
            const report = JSON.parse(fs.readFileSync(summary.report, "utf8"));
            expect(report.status).toBe("inconclusive");
            expect(report.reason).toBe("Timing instrumentation is active");
            expect(report.groups).toEqual({});
            if(mode === "global coverage") expect(report.coverage).toBe(true);
        } finally {
            fs.rmSync(directory, {recursive: true, force: true});
        }
    }, 10_000);

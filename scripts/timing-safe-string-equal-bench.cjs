const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const {randomUUID} = require("node:crypto");

const THRESHOLD = 7;
const ITERATIONS = 10_000;
const WARMUP = 50_000;
const ORDER = Array.from({length: 120}, (_, index) => index % 2 === 0 ? "AB" : "BA");
const GROUPS = ["hexTarget", "hexNoise", "decodedBufferTarget", "bufferNoise", "earlyExit"];
const GROUP_ORDER = ORDER.map((_, index) => {
    const offset = index % GROUPS.length;
    return [...GROUPS.slice(offset), ...GROUPS.slice(0, offset)];
});
const PRECISION = {blocks: 12, pairsPerBlock: 10, confidenceLevel: 0.95, tCritical: 2.2009851601};
const median = (values) => {
    const sorted = values.slice().sort((a, b) => a - b);
    const middle = sorted.length / 2;
    return (sorted[middle - 1] + sorted[middle]) / 2;
};

const statistics = (group) => {
    const signedPairs = group.earlySamplesNs.map((early, index) => {
        const late = group.lateSamplesNs[index];
        return (late - early) / ((early + late) / 2) * 100;
    });
    const blockMeansPercent = Array.from({length: PRECISION.blocks}, (_, block) => {
        const start = block * PRECISION.pairsPerBlock;
        return signedPairs.slice(start, start + PRECISION.pairsPerBlock)
            .reduce((sum, value) => sum + value, 0) / PRECISION.pairsPerBlock;
    });
    const signedMeanPercent = blockMeansPercent.reduce((sum, value) => sum + value, 0) / PRECISION.blocks;
    const variance = blockMeansPercent.reduce((sum, value) => sum + (value - signedMeanPercent) ** 2, 0)
        / (PRECISION.blocks - 1);
    const margin = PRECISION.tCritical * Math.sqrt(variance / PRECISION.blocks);
    return {blockMeansPercent, signedMeanPercent,
        confidenceIntervalPercent: {lower: signedMeanPercent - margin, upper: signedMeanPercent + margin}};
};
const bias = (group) => {
    const early = median(group.earlySamplesNs), late = median(group.lateSamplesNs);
    return Math.abs(early - late) / ((early + late) / 2) * 100;
};

function classifyMeasurements(groups) {
    const valid = GROUPS.every((name) => ["earlySamplesNs", "lateSamplesNs"].every((key) => {
        const samples = groups?.[name]?.[key];
        return Array.isArray(samples) && samples.length === ORDER.length &&
            samples.every((value) => Number.isFinite(value) && value > 0);
    }));
    if(!valid) return {status: "inconclusive", reason: "Incomplete or invalid measurement samples"};
    const biasPercent = Object.fromEntries(GROUPS.map((name) => [name, bias(groups[name])]));
    const groupStatistics = Object.fromEntries(GROUPS.map((name) => [name, statistics(groups[name])]));
    const precise = (name) => {
        const interval = groupStatistics[name].confidenceIntervalPercent;
        return interval.lower >= -THRESHOLD && interval.upper <= THRESHOLD;
    };
    const summary = {biasPercent, statistics: groupStatistics};
    if(["hexNoise", "bufferNoise"].some((name) => biasPercent[name] >= THRESHOLD || !precise(name)) ||
        biasPercent.earlyExit <= THRESHOLD || groupStatistics.earlyExit.confidenceIntervalPercent.lower <= THRESHOLD) {
        return {status: "inconclusive", reason: "Noise or sensitivity control failed", ...summary};
    }
    const targets = ["hexTarget", "decodedBufferTarget"];
    if(targets.some((name) => biasPercent[name] >= THRESHOLD)) {
        return {status: "fail", reason: "Target pooled bias reached the seven-percent threshold", ...summary};
    }
    if(targets.some((name) => !precise(name))) {
        return {status: "inconclusive", reason: "Target interval is not contained within the seven-percent bounds", ...summary};
    }
    return {status: "pass", ...summary};
}

module.exports = {classifyMeasurements};

if(require.main === module) {
    const args = process.argv.slice(2);
    const argument = (name) => {
        const index = args.indexOf(name);
        if(index < 0) return "";
        const end = args.findIndex((value, position) => position > index && value.startsWith("--"));
        return args.slice(index + 1, end < 0 ? undefined : end).join(" ");
    };
    const report = {
        requirement: "REQ-04", generatedAt: new Date().toISOString(),
        conditions: argument("--conditions"),
        node: process.version, v8: process.versions.v8, platform: process.platform, arch: process.arch,
        cpu: os.cpus()[0]?.model, cpuCount: os.cpus().length,
        loadAverage: process.platform === "win32" ? null : os.loadavg(),
        execArgv: process.execArgv, nodeOptions: process.env.NODE_OPTIONS || "",
        coverage: Boolean(process.env.COVERAGE || process.env.NODE_V8_COVERAGE || globalThis.__coverage__),
        method: "five-group-balanced-block-intervals-v2",
        iterations: ITERATIONS, warmup: WARMUP, samples: ORDER.length, order: ORDER,
        groupOrder: GROUP_ORDER, precision: PRECISION,
        thresholdPercent: THRESHOLD, sensitivityMinimumPercent: THRESHOLD,
        biasFormula: "abs(earlyMedian - lateMedian) / mean(earlyMedian, lateMedian) * 100",
        signedPairFormula: "(late - early) / mean(early, late) * 100",
        groups: {},
        note: "Finite macro-bias experiment, not proof of constant-time behavior; host conditions are operator supplied. Block intervals are descriptive under unknown serial dependence, not a coverage guarantee.",
    };
    const instrumented = report.coverage ||
        /--(?:inspect|prof|cpu-prof|heap-prof|trace|require|import|experimental-test-coverage)|--coverage|(?:^|\s|")-r/.test(
            [...process.execArgv, report.nodeOptions].join(" "));
    const builtHelper = path.resolve(__dirname, "../build/src/util/timingSafeStringEqual.js");
    if(!report.conditions.trim()) {
        Object.assign(report, {status: "inconclusive", reason: "Record execution conditions using --conditions"});
    } else if(instrumented) {
        Object.assign(report, {status: "inconclusive", reason: "Timing instrumentation is active"});
    } else if(!fs.existsSync(builtHelper)) {
        Object.assign(report, {status: "inconclusive", reason: "Build the production helper before measurement"});
    } else {
        const {timingSafeStringEqual} = require(builtHelper);
        const base = "f".repeat(64), early = "0" + "f".repeat(63), late = "f".repeat(63) + "0";
        const baseBuffer = Buffer.from(base, "hex"), earlyBuffer = Buffer.from(early, "hex"), lateBuffer = Buffer.from(late, "hex");
        // Sensitivity control deliberately leaks mismatch position; it is not a crypto substitute.
        const earlyExit = (isLate) => {
            const other = isLate ? lateBuffer : earlyBuffer;
            for(let index = 0; index < baseBuffer.length; index++) if(baseBuffer[index] !== other[index]) return false;
            return true;
        };
        const comparators = {
            hexTarget: (isLate) => timingSafeStringEqual(base, isLate ? late : early),
            hexNoise: () => timingSafeStringEqual(base, early),
            decodedBufferTarget: (isLate) => timingSafeStringEqual(baseBuffer, isLate ? lateBuffer : earlyBuffer),
            bufferNoise: () => timingSafeStringEqual(baseBuffer, earlyBuffer),
            earlyExit,
        };
        for(const name of GROUPS) {
            report.groups[name] = {earlySamplesNs: [], lateSamplesNs: []};
            for(let index = 0; index < WARMUP; index++) {
                comparators[name](index % 2 === 1);
            }
        }
        let equalCount = 0;
        const measure = (compare, other) => {
            const start = process.hrtime.bigint();
            for(let index = 0; index < ITERATIONS; index++) equalCount += Number(compare(other));
            return Number(process.hrtime.bigint() - start);
        };
        report.cpuUsageBefore = process.cpuUsage();
        for(let pair = 0; pair < ORDER.length; pair++) {
            for(const name of GROUP_ORDER[pair]) {
                const order = ORDER[pair];
                for(const label of order) {
                    const isEarly = label === "A";
                    report.groups[name][isEarly ? "earlySamplesNs" : "lateSamplesNs"].push(
                        measure(comparators[name], !isEarly));
                }
            }
        }
        report.cpuUsageAfter = process.cpuUsage();
        Object.assign(report, equalCount === 0 ? classifyMeasurements(report.groups) :
            {status: "inconclusive", reason: "A mismatch comparator unexpectedly returned true"});
    }
    const directory = path.resolve(argument("--output-dir") || "results/timing");
    fs.mkdirSync(directory, {recursive: true});
    const filename = path.join(directory, `req-04-${report.generatedAt.replace(/[:.]/g, "-")}-${process.pid}-${randomUUID()}.json`);
    fs.writeFileSync(filename, JSON.stringify(report, null, 2) + "\n", {flag: "wx"});
    console.log(JSON.stringify({status: report.status, reason: report.reason, biasPercent: report.biasPercent, report: filename}));
    process.exitCode = report.status === "pass" ? 0 : report.status === "fail" ? 1 : 2;
}

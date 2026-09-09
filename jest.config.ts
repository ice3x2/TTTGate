import type { Config } from "jest";

// NOTE: package.json inline jest 블록을 이 파일로 이관(P1-T1/REQ-20).
// 단위 대역과 실제 통신 증거의 범위: docs/guide/test-evidence-policy.md.
//
// Whole-source coverage protects the four original issue52 baselines.

const config: Config = {
    rootDir: ".",
    testMatch: [
        "<rootDir>/test/**/*.test.(js|ts)"
    ],
    transform: {
        "^.+\\.ts$": [
            "ts-jest",
            {
                diagnostics: true,
                isolatedModules: true
            }
        ]
    },
    moduleFileExtensions: ["ts", "tsx", "js", "json"],
    testEnvironment: "node",
    // coverage 인프라 — `npm run test:coverage`에서 실행.
    collectCoverageFrom: ["src/**/*.ts", "!src/**/*.d.ts"],
    coverageDirectory: "<rootDir>/coverage",
    coverageReporters: ["text", "lcov", "json-summary"],
    coverageThreshold: {
        global: {
            lines: 64.26,
            functions: 69.74,
            branches: 52.23,
            statements: 63.71
        }
    },
    // stress / e2e 제외 (기본 run에는 포함되지만 Phase 1 인프라 수립 목적상 유지).
    testPathIgnorePatterns: [
        "/node_modules/",
        "/build/",
        "/dist/"
    ]
};

export default config;

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
                // ts-jest 29.4 는 isolatedModules 옵션을 tsconfig 에서 읽는다(#192). 루트 tsconfig 는 빌드용이라 false 다.
                tsconfig: "<rootDir>/tsconfig.jest.json"
            }
        ]
    },
    moduleFileExtensions: ["ts", "tsx", "js", "json"],
    testEnvironment: "node",
    // node-forge 가 jest 안에서 느린 곱셈(am1)을 고르지 않게 navigator 를 지운다(#194).
    setupFiles: ["<rootDir>/test/setup/forgeBigInteger.ts"],
    // 테스트가 저장소 작업 트리의 파일을 만들거나 바꾸면 실행을 실패로 끝낸다(#264).
    // 같은 작업 트리에서 jest 를 여러 개 동시에 돌릴 때는 TTTGATE_SKIP_WORKTREE_GUARD=1 로 끈다.
    globalSetup: "<rootDir>/test/setup/worktreeGuardSetup.ts",
    globalTeardown: "<rootDir>/test/setup/worktreeGuardTeardown.ts",
    // coverage 인프라 — `npm run test:coverage`에서 실행.
    collectCoverageFrom: ["src/**/*.ts", "!src/**/*.d.ts"],
    coverageDirectory: "<rootDir>/coverage",
    coverageReporters: ["text", "lcov", "json-summary"],
    coverageThreshold: {
        global: {
            lines: 85.48,
            functions: 90.66,
            branches: 75.59,
            statements: 84.67
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

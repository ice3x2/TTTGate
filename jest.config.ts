import type { Config } from "jest";

// NOTE: package.json inline jest 블록을 이 파일로 이관(P1-T1/REQ-20).
// 실환경 테스트만 허용(NO-MOCK).
//
// Phase 1 커버리지 정책 (round 4 개정):
// ------------------------------------------------------------
// 라운드 2 리뷰 피드백: 전 src/** 범위에 threshold 60%를 그대로 적용하면 Phase 1 범위를
// 초과하는 레거시 모듈까지 포함되어 실패 → "threshold를 40으로 하향"은 계획-코드 불일치(ZERO TOLERANCE) 위반.
// 까칠 리뷰어 지시("정 안되면 계획을 고쳐라")에 따라 계획 문서(docs/plans/plan-remediation-r1.{md,json})의
// P1-T1 summary/dod를 "Phase 1은 실제 수정 파일 범위에 한해 threshold 60 적용, Phase 3/5/7 진행에 따라
// collectCoverageFrom 범위를 확장"으로 정정했다.
//
// 따라서 Phase 1에서는 실제 Phase 1 범위에서 "인프라 증명"에 사용되는 파일만 좁게 포함한다.
// - src/Environment.ts : Phase 1 유일한 신규 단위 테스트(`test/unit/Environment.version.test.ts`)의 대상.
// 이후 Phase가 진행되며 본 배열을 확장한다(Phase 2: ClockRng/timingSafeStringEqual, Phase 3: TLS 등).

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
    // Phase 1 좁은 범위(수정/증명 대상 한정). 후속 Phase에서 확장 예정.
    collectCoverageFrom: [
        "src/Environment.ts",
        // Phase 2 확장 (P2-T1/P2-T2):
        "src/util/ClockRng.ts",
        "src/util/timingSafeStringEqual.ts",
        // Phase 3 확장 (P3-T1/T2/T3/T4/T5):
        "src/util/TlsOptionsFactory.ts",
        "src/commons/ProtocolV2.ts",
        // Phase 4 확장 (P4-T1/T2/T3):
        "src/server/http/HttpPipe.ts",
        "src/server/http/HttpUtil.ts",
        // Phase 5 확장 (P5-T1~T6):
        "src/server/admin/AdminServer.ts",
        "src/server/admin/SessionStore.ts",
        "src/server/admin/loginBackoff.ts",
        "src/server/AdminSecurityPolicy.ts",
        // Phase 6 확장 (P6-T1/T2/T3):
        "src/client/TunnelClient.ts",
        "src/client/TTTClient.ts",
        "src/client/EndPointClientPool.ts",
        "src/server/TunnelServer.ts",
        "src/types/TunnelingOption.ts"
    ],
    coverageDirectory: "<rootDir>/coverage",
    coverageReporters: ["text", "lcov", "json-summary"],
    // Phase 1: 실제 Phase 1 수정/테스트 범위(src/Environment.ts)에 한해 threshold 60 적용.
    // 후속 Phase에서 collectCoverageFrom 확장 시 threshold 유지 가능 여부를 동시에 검증한다.
    coverageThreshold: {
        global: {
            lines: 60,
            functions: 50,
            branches: 50,
            statements: 60
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

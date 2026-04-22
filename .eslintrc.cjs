/**
 * .eslintrc.cjs — P1-T2 / REQ-21
 *
 * 목적: 인증 관련 식별자의 `===`/`!==` 비교를 휴리스틱으로 경고한다.
 * P7-T2에서 error로 승격됨(완료). ESLint가 프로젝트에 전역 설치되지 않았을 수 있으므로
 * `npm run lint`는 scripts/lint-auth-compare.mjs(Node 폴백)로 실행된다.
 * 본 파일은 ESLint가 존재하는 IDE/개발 환경을 위한 선언이다.
 */
module.exports = {
    root: true,
    env: {
        node: true,
        es2022: true
    },
    parserOptions: {
        ecmaVersion: 2022,
        sourceType: "module"
    },
    ignorePatterns: [
        "node_modules/",
        "build/",
        "dist/",
        "coverage/",
        "admin/",
        "reports/",
        "test/",
        "deploy.js",
        "jest.config.ts",
        // scripts/ 는 CLI 보조 스크립트(smoke.mjs, lint-auth-compare.mjs 등) — ESLint 대상 제외 (의도적)
        // Node ESM/mjs 파서 요구사항이 src/ TypeScript 파서 설정과 상이하며, Phase 1 범위에서
        // 해당 스크립트들은 자체적으로 단순하고 직접 실행만 된다. 필요 시 Phase 7에서 별도 overrides로 포함.
        "scripts/"
    ],
    rules: {
        // 휴리스틱: authKey|proof|token|secret|hmac 식별자 부근에서 === 또는 !== 사용 경고.
        // 정밀 매칭은 scripts/lint-auth-compare.mjs 스크립트가 담당한다.
        "no-restricted-syntax": [
            "error",
            {
                // MEDIUM-A 수정: 정규식 alternation 그룹핑 괄호 추가.
                // 이전: /^===|!==|==|!=$/ → 의미상 /^===/ OR /!==/ OR /==/ OR /!=$/ 로 잘못 해석됨.
                // 교정: /^(===|!==|==|!=)$/ 로 정확한 OR 그룹핑 적용.
                selector:
                    "BinaryExpression[operator=/^(===|!==|==|!=)$/][left.name=/authKey|proof|token|secret|hmac|bindingToken|challengeNonce|sessionId/i]",
                message:
                    "Use timingSafeStringEqual for auth-sensitive comparisons (REQ-21)."
            },
            {
                selector:
                    "BinaryExpression[operator=/^(===|!==|==|!=)$/][right.name=/authKey|proof|token|secret|hmac|bindingToken|challengeNonce|sessionId/i]",
                message:
                    "Use timingSafeStringEqual for auth-sensitive comparisons (REQ-21)."
            }
        ]
    }
};

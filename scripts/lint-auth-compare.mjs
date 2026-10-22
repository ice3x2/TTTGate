#!/usr/bin/env node
// lint-auth-compare.mjs — P1-T2 / REQ-21
//
// 목적: 인증 관련 식별자(authKey|proof|token|secret|hmac)가 `===`/`!==`/`==`/`!=`
// 연산자로 비교되는 위치를 감지한다. 상수시간 비교 헬퍼(timingSafeStringEqual) 도입을
// 유도하기 위한 휴리스틱 린트. (ESLint no-restricted-syntax와 상호 보완)
//
// 사용:
//   node scripts/lint-auth-compare.mjs [path ...] [--report-dir <dir>]
//
// --report-dir <dir>: 리포트 출력 디렉터리를 재지정한다 (테스트 격리용).
//                     미지정 시 cwd/reports 사용 (기존 CLI 호환).
//
// 기본 exit 정책:
//   - 위반 없음 → exit 0
//   - 위반 존재 + 환경변수 LINT_AUTH_COMPARE_STRICT=1 → exit 1 (P7-T2 error 승격용)
//   - 위반 존재 + STRICT 미설정 → exit 0 (warn 허용; P1-T2 DoD: error 0건)
//
// 출력: stdout = JSON Lines (violations + summary)
//        reports/auth-compare.json = 전체 리포트 파일

import { readFileSync, readdirSync, statSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join, resolve, relative, sep } from "node:path";
import { cwd, argv, exit, env } from "node:process";

const IDENTIFIER_PATTERN = /\b(authKey|proof|token|secret|hmac|bindingToken|challengeNonce|sessionId)\b/i;
// 인증 비교 식별자 — 실제 LHS/RHS 토큰에 이들이 포함될 때에만 violation 으로 집계한다.
const AUTH_TOKEN_RE = /\b(authKey|proof|token|secret|hmac|bindingToken|challengeNonce|sessionId)\b/i;
// === / !== / == / != (화살표 함수, 기타 오탐 최소화를 위해 공백 포함)
// JS arrow(=>) 와 assignment(=)는 제외.
const OPERATOR_PATTERN = /(?<![=!<>])(===|!==|==|!=)(?!=)/g;

/**
 * P7-T2 / REQ-21: 컨텍스트 기반 false-positive 필터.
 *
 * IDENTIFIER_PATTERN 이 라인 어딘가에 존재하고 비교 연산자가 있다고 해서 모두 인증 비교는 아니다.
 * 다음 케이스를 false positive 로 제외한다:
 *  - `=== undefined` / `!== undefined` / `== undefined` / `!= undefined`  (존재 체크)
 *  - `=== null` / `!== null` ...                                           (null 체크)
 *  - `== -?\d+` (수치 sentinel, e.g. `sessionID > -1`, `!= -1`)
 *  - enum 스타일 상수 비교: `== EnumName.Member` (e.g. `SocketState.End`, `CtrlCmd.SuccessOfOpenSession`)
 *  - 양쪽 피연산자 중 어느 쪽도 AUTH_TOKEN_RE 에 매칭되지 않는 경우(IDENTIFIER 는 주석/문자열/로그 메시지에 존재)
 */
function extractOperandTokens(line, matchIndex, opLen) {
    // LHS: 연산자 왼쪽에서 공백/괄호 경계까지의 마지막 토큰
    const leftSrc = line.slice(0, matchIndex);
    const rightSrc = line.slice(matchIndex + opLen);
    // LHS 마지막 토큰 — 식별자/멤버접근 체인(a.b.c) 또는 리터럴
    const lhsMatch = leftSrc.match(/([A-Za-z_$][\w$]*(?:\??\.[A-Za-z_$][\w$]*)*|-?\d+)\s*$/);
    // RHS 첫 토큰
    const rhsMatch = rightSrc.match(/^\s*(undefined|null|true|false|-?\d+|"[^"]*"|'[^']*'|[A-Za-z_$][\w$]*(?:\??\.[A-Za-z_$][\w$]*)*)/);
    return {
        lhs: lhsMatch ? lhsMatch[1] : "",
        rhs: rhsMatch ? rhsMatch[1] : ""
    };
}

function isFalsePositive(lhs, rhs) {
    const isSentinel = (t) => {
        if (!t) return false;
        if (t === "undefined" || t === "null" || t === "true" || t === "false") return true;
        if (/^-?\d+$/.test(t)) return true; // -1, 0, 42 등
        // 주의: 문자열 리터럴은 sentinel 로 취급하지 않는다. `token !== "secret"` 같은
        // 하드코딩 비교는 실제 인증 비교일 수 있으므로 violation 으로 유지한다.
        // Enum-style constant access: PascalCase + dot + member (e.g. SocketState.End, CtrlCmd.X)
        if (/^[A-Z][A-Za-z0-9_]*\.[A-Za-z_$][\w$]*$/.test(t)) return true;
        return false;
    };
    // 양쪽 모두 sentinel/enum 이면 인증 비교 아님.
    if (isSentinel(lhs) && isSentinel(rhs)) return true;
    // 어느 한쪽이 sentinel 이고 상대가 AUTH_TOKEN_RE 매칭 토큰이 아니면 false positive.
    // 또한 AUTH 식별자가 LHS/RHS 어디에도 없으면 (line 다른 곳에만 존재) false positive.
    const lhsAuth = AUTH_TOKEN_RE.test(lhs);
    const rhsAuth = AUTH_TOKEN_RE.test(rhs);
    if (!lhsAuth && !rhsAuth) return true;
    // AUTH 식별자와 비교 상대가 sentinel/enum 이면 상태 체크로 판단하고 제외.
    if ((lhsAuth && isSentinel(rhs)) || (rhsAuth && isSentinel(lhs))) return true;
    return false;
}

const DEFAULT_EXCLUDE_GLOBS = [
    /[\\/]node_modules[\\/]/,
    /[\\/]build[\\/]/,
    /[\\/]dist[\\/]/,
    /[\\/]coverage[\\/]/,
    /[\\/]admin[\\/]/, // admin SPA 소스는 별도 경계
    /[\\/]test[\\/]/,  // 테스트는 명시적 비교 허용(부정 기대값)
    /[\\/]reports[\\/]/
];

const ALLOW_COMMENT = "lint-auth-compare-allow";

function isSourceFile(path) {
    return /\.(ts|js|mjs|cjs)$/i.test(path);
}

function isExcluded(path) {
    return DEFAULT_EXCLUDE_GLOBS.some((rx) => rx.test(path));
}

function walk(rootDir, acc = []) {
    let entries;
    try {
        entries = readdirSync(rootDir, { withFileTypes: true });
    } catch {
        return acc;
    }
    for (const ent of entries) {
        const full = join(rootDir, ent.name);
        if (isExcluded(full)) continue;
        if (ent.isDirectory()) {
            walk(full, acc);
        } else if (ent.isFile() && isSourceFile(full)) {
            acc.push(full);
        }
    }
    return acc;
}

function scanFile(absPath) {
    const src = readFileSync(absPath, { encoding: "utf-8" });
    const lines = src.split(/\r?\n/);
    const violations = [];
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line.includes(ALLOW_COMMENT)) continue;
        // 라인 주석 영역은 관심 밖 — 단순 //로 시작만 스킵(정밀 파서 불필요)
        const trimmed = line.trimStart();
        if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) continue;
        if (!IDENTIFIER_PATTERN.test(line)) continue;
        OPERATOR_PATTERN.lastIndex = 0;
        let match;
        while ((match = OPERATOR_PATTERN.exec(line)) !== null) {
            // P7-T2: 연산자 양쪽 피연산자 토큰을 추출해 false positive 를 제외한다.
            const { lhs, rhs } = extractOperandTokens(line, match.index, match[1].length);
            if (isFalsePositive(lhs, rhs)) continue;
            violations.push({
                file: absPath,
                line: i + 1,
                column: match.index + 1,
                operator: match[1],
                snippet: line.trim().slice(0, 200),
                lhs,
                rhs
            });
        }
    }
    return violations;
}

function parseArgs(rawArgs) {
    const targets = [];
    let reportDir = null;
    let strictFlag = false;
    for (let i = 0; i < rawArgs.length; i++) {
        const a = rawArgs[i];
        if (a === "--report-dir") {
            reportDir = rawArgs[i + 1];
            i += 1;
            continue;
        }
        if (a.startsWith("--report-dir=")) {
            reportDir = a.slice("--report-dir=".length);
            continue;
        }
        if (a === "--strict") {
            strictFlag = true;
            continue;
        }
        targets.push(a);
    }
    return { targets, reportDir, strictFlag };
}

function main() {
    const parsed = parseArgs(argv.slice(2));
    const targets = (parsed.targets.length > 0 ? parsed.targets : ["src"]).map((p) => resolve(cwd(), p));
    const allFiles = [];
    for (const t of targets) {
        let st;
        try { st = statSync(t); } catch { continue; }
        if (st.isDirectory()) {
            walk(t, allFiles);
        } else if (st.isFile() && isSourceFile(t) && !isExcluded(t)) {
            allFiles.push(t);
        }
    }

    const allViolations = [];
    for (const f of allFiles) {
        const v = scanFile(f);
        for (const item of v) allViolations.push({
            ...item,
            file: relative(cwd(), item.file).split(sep).join("/")
        });
    }

    const strict = env.LINT_AUTH_COMPARE_STRICT === "1" || parsed.strictFlag === true;
    const summary = {
        tool: "lint-auth-compare",
        version: "1.0.0",
        scannedFiles: allFiles.length,
        violationCount: allViolations.length,
        strict,
        generatedAt: new Date().toISOString()
    };

    // stdout: JSON Lines (각 위반 + 마지막 summary)
    for (const v of allViolations) {
        // eslint-disable-next-line no-console
        console.log(JSON.stringify({ type: "violation", ...v }));
    }
    // eslint-disable-next-line no-console
    console.log(JSON.stringify({ type: "summary", ...summary }));

    // 리포트 파일 (--report-dir 지정 시 테스트 격리 디렉터리 사용, 기본은 cwd/reports)
    const reportDir = parsed.reportDir
        ? resolve(cwd(), parsed.reportDir)
        : resolve(cwd(), "reports");
    if (!existsSync(reportDir)) mkdirSync(reportDir, { recursive: true });
    const reportPath = resolve(reportDir, "auth-compare.json");
    writeFileSync(reportPath, JSON.stringify({ summary, violations: allViolations }, null, 2), { encoding: "utf-8" });

    if (strict && allViolations.length > 0) {
        exit(1);
    }
    exit(0);
}

main();

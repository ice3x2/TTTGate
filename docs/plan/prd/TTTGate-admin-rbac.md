# TTTGate Admin RBAC Refactoring — PRD

| 항목 | 내용 |
|---|---|
| 문서 버전 | v0.2 (Iter1 평가 반영) |
| 작성일 | 2026-04-25 |
| 작성자 | PRD Writer (Opus) |
| 상태 | Iter1 평가자 A/B findings 반영 완료 — PM/Owner 검토 대기 |
| 관련 문서 | [TTTGate SRS](../srs/TTTGate.md), [Phase 02 Admin Surface Lockdown](../02.phase-2-admin-surface-lockdown.md), [Phase 02-1 Admin Legacy Migration](../02-1.admin-legacy-migration.md) |
| 대상 릴리스 | TTTGate v1.1.0 (admin RBAC 도입) |

---

## Table of Contents

1. Executive Summary
2. Problem & Opportunity
3. Goals, Non-Goals, Success Metrics
4. User Personas & Roles
5. Requirements
6. User Stories
7. 속성 매트릭스 (Attribute Matrix)
8. 마이그레이션 플랜
9. 위험 & 제약
10. 의존성
11. Out of Scope
12. Open Questions & Assumptions
13. Appendix A. 권한 결정 매트릭스 예시
14. Appendix B. 용어집
15. Appendix C. 참고 문서 / Traceability

---

## 1. Executive Summary

TTTGate 의 관리자 콘솔은 현재 **단일 `admin` 계정 + 12시간 TTL 세션 + bootstrap token** 구조로, 모든 관리 작업이 "admin 이냐 아니냐" 라는 이분법 위에서 동작한다. 터널 설정/Trusted Client/서버 옵션/인증서 관리가 같은 사용자에게 동시에 허용되며, 조직 내부에서 역할을 나누거나 개별 사용자의 터널만 책임지도록 제한하는 방법이 없다. 이 구조는 소규모 운영에는 충분하지만, 여러 운영자/외주/현장 담당자가 같은 TTTGate 인스턴스를 공유하는 시나리오에서 **과권한, 실수에 의한 전역 장애, 책임 추적 불가** 라는 문제를 일으킨다.

본 리팩토링은 관리자 콘솔을 **다사용자·다슈퍼유저·단일그룹 RBAC** 체계로 전환한다. 슈퍼유저가 사용자와 그룹을 만들고, 그룹에 **11종의 운영 속성**(포트 범위, 프로토콜, 동시 연결 수, Rate limit, UI 섹션 접근 등)을 부여하면, 일반 유저는 자기 그룹의 속성 범위 안에서만 터널을 운영할 수 있다. 동시에 관리자급 보안을 끌어올리는 **3종 필수 보안 기능**(감사 로그, TOTP MFA, 세션 강제 종료)을 도입해, 누가 언제 무엇을 했는지 추적하고 분실/유출된 계정을 즉시 차단할 수 있게 한다.

핵심 변화는 다음과 같다: (1) 기존 `admin` 단일 계정은 **마이그레이션 시점에 자동 슈퍼유저로 승격**되어 다운타임 없이 전환된다. (2) 터널은 **사용자 소유(user ownership)** 가 되며, Trusted Client 는 **전역(server-wide)** 으로 유지된다. (3) 권한이 없는 화면은 일반 유저에게 **숨김(hide)** 처리되어 "있지만 못 누르는" 혼란을 없앤다.

핵심 성공 기준은 숫자로 고정한다: **마이그레이션 다운타임 0초 / 마이그레이션 후 기존 admin 자격 승인 100% 재확인 / Audit 커버리지 100% / Rate limit 프리셋 4종(unlimited + 1 MB/s + 10 MB/s + 100 MB/s) 전수 동작 검증 통과**.

이 PRD 는 의도적으로 범위를 좁게 고정한다. QNA 3라운드에서 합의한 **11종 속성 + 3종 보안 기능 + 단일 그룹 소속 + 개인 override 금지** 만 In-scope 이며, 나머지(IP 제어, TLS 업로드, 시간대, 재승인, 그룹리더, API 토큰, 비밀번호 정책 개별화, 보존 기간 개별화, 다중 그룹, 계층 그룹, 사용자 단위 속성 override)는 본 리팩토링에서 다루지 않는다. 좁게 밀어내고, 확실히 끝낸다.

---

## 2. Problem & Opportunity

### 2.1 현재 상황 (As-Is)

- TTTGate 서버는 하나의 관리자 콘솔(`AdminServer`)을 가지며, 인증 주체는 **단일 admin 계정 하나**이다 (SRS `NFR-SEC-BCRYPT-001`, `BR-AUTH-005`).
- 로그인은 bcrypt 해시(cost 12) + 세션 쿠키 + CSRF double-submit + 실패 지수 백오프로 보호된다 (`NFR-SEC-CSRF-001`, `NFR-SEC-LOGIN-BACKOFF-001`).
- 최초 1회는 `config/.bootstrap-token` 으로 초기 비밀번호를 설정한다 (`FR-SRV-BOOTSTRAP-GEN-001`).
- 로그인 후에는 터널 추가/수정/삭제, Trusted Client 등록, 서버 옵션 변경, 인증서 교체 등 **모든 관리 작업이 사용자 구분 없이 동일하게 허용**된다.
- 현재 **명시적 로그아웃 엔드포인트가 없다** (SRS `BR-AUTH-006`). 세션 무효화 경로는 TTL 만료, 수동 쿠키 삭제, 서버 재시작 뿐이다.
- 감사 로그는 런타임 WARN/ERROR 로거 수준이며 (`FR-SRV-AUDIT-LOG-001`), 누가 어떤 관리 행위를 했는지 구조화해 보관하지 않는다.

### 2.2 페인 포인트

| # | 페인 | 누가 아픈가 | 비즈니스 영향 |
|---|---|---|---|
| P1 | 여러 운영자가 같은 `admin` 계정을 공유해야 함 | 서버 운영자, 보안팀 | 누가 한 일인지 추적 불가, 사고 대응 지연 |
| P2 | 외주/현장 담당자에게 "자기 터널만 만지게" 할 방법이 없음 | 서비스 오너 | 실수 한 번에 타 팀 터널 중단 위험 |
| P3 | 비밀번호 공유 외 2차 인증 수단 없음 | 보안팀 | 계정 탈취 시 즉시 전권 장악 |
| P4 | 세션 강제 종료 경로 부재 | 보안팀, IT 헬프데스크 | 의심 세션을 TTL(12시간, 43,200,000ms)까지 살려둬야 함 |
| P5 | 포트 범위/대역폭 등 운영 가드레일이 전역 단일 설정 | 서비스 오너 | 한 유저가 전 포트/전 대역을 점유 가능 |
| P6 | Audit 증적이 구조화되어 있지 않음 | 컴플라이언스, 감사 | "누가 언제 이 터널을 삭제했는가"에 답할 수 없음 |

### 2.3 기회 (Why Now)

- 바로 직전 리팩토링(Phase 2 Admin Surface Lockdown, Phase 4 Protocol v2) 에서 **관리자 보안 경계(loopback bind, TLS 기본, CSRF, login backoff, v2 client identity)** 가 이미 정리되어, 그 위에 **권한 계층**만 얹으면 된다.
- bootstrap token + bcrypt + SessionStore 구조는 **다계정으로 확장 가능한 형태**로 남아 있어, 스키마 확장만으로 RBAC 도입이 가능하다.
- 터널 설정·Trusted Client·서버 옵션이 **YAML 파일 + 원자적 저장**으로 이미 분리되어 있어 (`FR-SRV-YAML-ATOMIC-001`), 소유권 필드만 추가해도 기존 런타임에 영향이 없다.
- **지금 하지 않으면** 다사용자 수요는 각 사이트마다 "admin 비밀번호 돌려쓰기" 로 우회되고, 사고 발생 시 추적/롤백 비용이 기하급수적으로 커진다.

---

## 3. Goals, Non-Goals, Success Metrics

### 3.1 목표 (Goals)

| ID | 목표 | 비즈니스 가치 |
|---|---|---|
| G1 | 슈퍼유저 / 일반 유저 2단 역할 체계 도입 | 한 명의 실수로 전체가 멈추지 않게 한다 |
| G2 | 단일 그룹 소속 + 그룹 속성 11종으로 권한을 선언적으로 표현 | 운영 정책을 코드가 아닌 설정으로 정의한다 |
| G3 | 터널을 사용자 소유로 만들고 "내 터널만 보이게" 구성 | 팀 간 간섭을 제거한다 |
| G4 | 감사 로그·MFA·세션 강제 종료 3종 도입 | 추적 가능성과 사고 대응 속도를 확보한다 |
| G5 | 기존 admin 사용자를 다운타임 0 으로 슈퍼유저로 승격 | 배포 리스크를 실사용자 체감 0 으로 낮춘다 |

### 3.2 Non-Goals (이번 범위 외)

> 본 섹션은 요약이다. 상세 제외 사유 및 향후 일정(백로그/차기 PRD/vX.Y 검토)은 §11 Out of Scope 참고.

- 사용자 단위 속성 override (개인 예외)
- 다중 그룹 소속 / 계층 그룹(부모-자식)
- 사용자 기반 비밀번호 정책(개별 유효기간, 복잡도 규칙)
- Audit 로그 개별 보존 기간(사용자/그룹별 다른 보존)
- IP 기반 접근 제어, 시간대/시간창 제어, 재승인 워크플로우
- TLS 인증서 사용자 업로드, 그룹 리더 위임, API 토큰 발급
- 터널 이외 리소스(Trusted Client)의 사용자 소유화
- 프론트엔드 전체 재디자인 (권한 기반 숨김 처리만 수행)

### 3.3 KPI (측정 가능한 성공 지표)

| KPI | 목표값 | 측정 방법 | 측정 시점 |
|---|---|---|---|
| K1. 마이그레이션 다운타임 | **0초** | 업그레이드 전/후 Admin API 헬스 프로브 중단 구간을 1초 단위 폴링 로그로 측정, 실패 응답 구간 = 0 | 릴리스 당일 |
| K2. 마이그레이션 후 기존 admin 자격 승인율 | **100%** (마이그레이션 후 기존 admin 자격이 슈퍼유저로 100% 재확인됨) | 업그레이드 후 7일 이내 `admin` 계정의 슈퍼유저 성공 로그인 이벤트(Audit `login_success` + role=superuser) ≥ 1 건, MIGRATION.md 체크리스트 사인오프 | 릴리스 +7일 |
| K3. Audit 로그 캡처 커버리지 | **100%** (Create/Update/Delete 대상 관리 API 전수) | 자동 테스트로 CUD 엔드포인트별 audit 레코드 존재 여부 검증 (CI 통합 테스트 `audit_coverage.spec.ts`) | CI 게이트 |
| K4. Rate limit 명세 동작 검증 | **프리셋 4종 전수 통과** (`unlimited` / `1 MB/s` / `10 MB/s` / `100 MB/s`) | 통합 테스트에서 프리셋별 1초 평균 전송량을 측정해 비-`unlimited` 3종은 목표값 ±5% 이내 수렴, `unlimited` 는 스로틀 미적용(토큰 버킷 바이패스) 확인 | CI 게이트 + 릴리스 전 |

보조 지표:

| KPI | 목표값 | 측정 방법 | 측정 시점 |
|---|---|---|---|
| K5. 평균 권한 체크 오버헤드 | **≤ 2 ms / request (p95)** | Admin API 미들웨어 훅에서 체크 시작/종료 타임스탬프 기록, 릴리스 전 부하 테스트에서 p95 집계 | 릴리스 전 |
| K6. 슈퍼유저 수 | **≥ 1 상시** (마지막 슈퍼유저 삭제 금지 정책 위반 시도 0건) | FR-USER-LAST-SUPERUSER-001 가드가 거부(4xx) 응답을 낸 Audit `last_superuser_guard_hit` 이벤트 집계 | 상시 |
| K7. 임시비번 → 첫 로그인 강제 변경 완료율 | **100%** | Audit `temp_password_issued` 카운트 대비 `password_changed(first_login=true)` 카운트가 릴리스 +30일 내 동일값으로 수렴 | 릴리스 +30일 |

---

## 4. User Personas & Roles

### 4.1 슈퍼유저 (Super User)

- **정의:** 시스템 전역 관리자. 사용자/그룹/서버 옵션/인증서/Trusted Client/Audit 로그 전수 열람 및 변경 권한을 가진다.
- **복수 허용:** 다수 슈퍼유저가 존재할 수 있다. 단, **항상 최소 1명 유지** 된다(마지막 슈퍼유저 삭제/강등 금지).
- **그룹 소속:** 슈퍼유저도 **읽기 전용 시스템 그룹 `system:superuser` 에 자동 소속**된다. 이 그룹은 수정/삭제/탈퇴가 금지되며, 11종 속성 제약은 슈퍼유저에 대해 일괄 무시된다(전역 허용). 이를 통해 "사용자는 반드시 하나의 그룹에 속한다"는 불변조건(FR-GROUP-MEMBER-ASSIGN-001)을 일관되게 유지한다.
- **전형적 업무:** 신규 운영자 온보딩, 그룹 설계, 사고 조사, 세션 강제 종료.
- **MFA:** 슈퍼유저 MFA 강제 토글(NFR 상 기본 off). 운영 정책으로 on 전환 가능, 본 PRD 에서는 "토글 존재"까지 정의.

### 4.2 일반 유저 (Regular User)

- **정의:** 단일 그룹에 소속되어, 그룹이 부여한 11종 속성의 범위 내에서만 자기 소유 터널을 운영한다.
- **가능한 일:** 본인 터널 CRUD, 본인 터널 상태 조회, 본인 Audit 로그 조회.
- **불가능한 일:** 타 사용자 터널 조회/수정, Trusted Client 관리, 서버 옵션 변경, 인증서 관리, 타 사용자 Audit 로그 조회.
- **UI 경험:** 권한 없는 섹션은 네비게이션에서 **숨김**.

### 4.3 그룹 (Group)

- **정의:** 속성 부여의 유일 단위. 사용자는 정확히 한 그룹에 속한다.
- **속성:** 11종 (7 절 참조). 개인 override 는 금지.
- **시스템 그룹:** 읽기 전용 시스템 그룹 2종이 기본 제공된다. (a) `system:superuser` — 슈퍼유저 전용, 속성 제약 무시, 탈퇴/삭제/수정 불가. (b) `default` — 일반 유저 초기 배속용, 속성은 7 절 기본값으로 초기화되며 슈퍼유저가 이후 수정 가능.
- **기본 그룹:** 마이그레이션 시점에 `default` 그룹과 `system:superuser` 그룹이 동시에 생성된다. 기존 admin 은 `system:superuser` 에 자동 소속된다.
- **삭제 정책:** 사용자 정의 그룹은 소속 사용자가 0 명일 때만 삭제 가능. `system:superuser`, `default` 시스템 그룹은 삭제 불가.

### 4.4 기존 단일 admin 대비 변화

| 측면 | 기존 | 변경 |
|---|---|---|
| 계정 모델 | 단일 `admin` | 다사용자, 슈퍼유저 다수 |
| 권한 모델 | 있음/없음 2진 | 슈퍼유저 / 그룹 속성 기반 |
| 터널 소유 | 없음 (공용) | 사용자 |
| 세션 무효화 | TTL 12시간(43,200,000ms) 만 | TTL + 명시 로그아웃 + 슈퍼유저 강제 종료 |
| 감사 증적 | 비구조 로거 | 구조화된 Audit Log, 보존 90일(기본) |
| 2차 인증 | 없음 | TOTP MFA |
| UI 권한 처리 | 해당 없음 | 권한 없는 섹션 숨김 |

---

## 5. Requirements

### 5.1 기능 요구사항 (Functional)

#### 5.1.1 사용자 관리 (CRUD, 임시비번, 첫 로그인 강제 변경)

- **FR-USER-CRUD-001** 슈퍼유저는 사용자를 생성/조회/수정/삭제할 수 있다. *Why:* 운영자 온보딩·오프보딩의 유일한 경로를 단일 화면으로 제공해 실수를 줄인다.
- **FR-USER-TEMP-PW-001** 사용자 생성 시 슈퍼유저가 임시 비밀번호를 설정한다. 초기 비밀번호는 평문으로 화면에 1회 노출된 후 저장은 bcrypt 해시로만 이뤄진다. *Why:* 기존 bootstrap token 흐름과 동질적으로 안전한 온보딩 경로를 유지한다.
- **FR-USER-FIRST-LOGIN-FORCE-001** 임시 비밀번호로 첫 로그인 시 사용자는 즉시 비밀번호 변경 화면으로 리디렉션되며, 변경 완료 전에는 다른 API 사용이 차단된다. *Why:* 임시 비밀번호의 잔존 리스크를 구조적으로 제거한다.
- **FR-USER-ROLE-001** 사용자는 `superuser` 또는 `regular` 중 하나의 역할을 갖는다. 역할은 슈퍼유저만 변경할 수 있다. *Why:* 권한 승격/강등을 명시적 관리 행위로 가시화한다.
- **FR-USER-LAST-SUPERUSER-001** 마지막 슈퍼유저의 강등/삭제/비활성화 시도는 거부된다. *Why:* 락아웃 위험을 선언적으로 차단한다.
- **FR-USER-STATUS-001** 사용자는 `active`/`disabled` 상태를 가지며, disabled 사용자는 로그인할 수 없고 기존 세션은 즉시 무효화된다. *Why:* 퇴사/오프보딩 시 단일 토글로 접근을 끊는다.

#### 5.1.2 그룹 관리 (CRUD, 속성 부여)

- **FR-GROUP-CRUD-001** 슈퍼유저는 그룹을 생성/조회/수정/삭제할 수 있다. *Why:* 정책을 선언적으로 관리한다.
- **FR-GROUP-ATTR-ASSIGN-001** 그룹 수정 시 11종 속성을 모두 설정할 수 있고, 미지정 속성은 7 절의 "기본값(그룹 미지정)"을 따른다. *Why:* 모든 속성이 결정적 기본값을 갖도록 해 예측 가능한 권한 체크를 보장한다.
- **FR-GROUP-MEMBER-ASSIGN-001** 사용자는 정확히 하나의 그룹에 속한다. 그룹 미지정 상태는 허용되지 않는다. 일반 유저는 최소 `default` 시스템 그룹에 속하고, 슈퍼유저는 `system:superuser` 시스템 그룹에 자동 소속되며 해당 그룹에서 탈퇴/재배치될 수 없다. 역할이 `superuser` 로 변경되면 자동으로 `system:superuser` 로, `regular` 로 강등되면 `default` 로 이동한다. *Why:* "권한의 회색 지대" 를 제거하고 슈퍼유저-그룹 관계 모순을 제거한다.
- **FR-GROUP-DELETE-GUARD-001** 소속 사용자 수가 > 0 인 그룹은 삭제할 수 없다. *Why:* 고아 사용자를 만들지 않는다.

#### 5.1.3 속성 매트릭스 (11종)

7 절 "속성 매트릭스" 참조. 매트릭스는 본 문서의 정합성 기준(single source of truth)이다. 어떤 구현이라도 7 절에 없는 속성을 도입하려면 PRD 개정이 선행돼야 한다.

#### 5.1.4 감사 로그 (Audit Log)

- **FR-AUDIT-CAPTURE-001** 관리 API 중 생성/수정/삭제(CUD) 성공·실패 호출 전수를 Audit 로그로 기록한다. 기록 항목: 시각, 행위자 userId, 세션 ID(해시), 대상 리소스 유형, 대상 리소스 ID, 변경 요약, 성공/실패 여부, 요청 IP(신뢰 정책 존중). *Why:* "누가 언제 무엇을" 질문에 구조적으로 답한다.
- **FR-AUDIT-READ-SU-001** 슈퍼유저는 전체 Audit 로그를 열람/필터(사용자·리소스·시간범위)할 수 있다.
- **FR-AUDIT-READ-SELF-001** 일반 유저는 본인 행위에 한해 Audit 로그를 열람할 수 있다.
- **FR-AUDIT-RETENTION-001** 기본 보존 기간은 **90일**. 서버 설정으로 변경 가능(서버 전역 단일 값). *Why:* 컴플라이언스 요구의 최소 공통분모.
- **FR-AUDIT-TAMPER-RESIST-001** Audit 로그는 일반 관리 API 경로로 수정/삭제할 수 없다. *Why:* "삭제 자체가 증적" 이 되도록 한다.

#### 5.1.5 MFA (TOTP)

- **FR-MFA-ENROLL-001** 사용자는 본인 계정에 TOTP 를 등록/해제할 수 있다. 등록 시 QR + 복구 코드 세트(일회용 N개)가 한 번만 노출된다.
- **FR-MFA-ENFORCE-001** MFA 가 활성화된 사용자의 로그인은 (비밀번호 + TOTP 코드) 양쪽을 요구한다. 복구 코드로 1회성 로그인이 가능하다.
- **FR-MFA-SU-POLICY-001** 슈퍼유저 계정에 대해서는 MFA 강제를 서버 옵션으로 토글할 수 있다. *Why:* 고위험 계정에 대한 2차 방어선을 선택적으로 강제한다.
- **FR-MFA-RESET-001** 슈퍼유저는 다른 사용자의 MFA 를 초기화할 수 있으며, 초기화 행위는 Audit 로그로 남는다.

#### 5.1.6 세션 강제 종료

- **FR-LOGOUT-001** 명시적 로그아웃 엔드포인트를 제공한다. 호출 시 서버측 세션 항목과 쿠키가 무효화된다. *Why:* SRS `BR-AUTH-006` 에서 확인된 결함을 해소한다.
- **FR-SESSION-LIST-001** 슈퍼유저는 현재 활성 세션 목록(사용자, 시작 시각, 최근 활동, IP)을 열람할 수 있다.
- **FR-SESSION-KILL-001** 슈퍼유저는 특정 세션 또는 특정 사용자의 모든 세션을 즉시 무효화할 수 있다.
- **FR-SESSION-SELF-KILL-001** 사용자는 본인 세션을 모두 로그아웃할 수 있다("다른 기기에서 로그아웃").

### 5.2 비기능 요구사항 (Non-Functional)

#### 5.2.1 보안 (마이그레이션 중 현재 보안 경계 유지)

- **NFR-SEC-PRESERVE-001** 본 리팩토링은 기존 관리자 보안 경계를 **약화하지 않는다**. 구체적으로 loopback bind 기본, TLS 기본, CSRF double-submit, 로그인 지수 백오프, bcrypt cost 12, 세션 쿠키 HttpOnly/Secure/SameSite, bootstrap token 0o600 권한은 그대로 유지된다.
- **NFR-SEC-NEW-ENDPOINT-CSRF-001** 새로 추가되는 모든 상태변경 관리 API 는 기존 CSRF 정책의 적용을 받는다.
- **NFR-SEC-NEW-ENDPOINT-BACKOFF-001** MFA 코드 검증 실패, 복구 코드 검증 실패도 로그인 백오프 정책에 포함된다.
- **NFR-SEC-AUDIT-INTEGRITY-001** Audit 레코드는 append-only 로 취급되며, 관리 API 는 읽기만 제공한다.

#### 5.2.2 성능 (권한 체크 오버헤드 목표)

- **NFR-PERF-PERMCHECK-001** 권한 체크는 p95 기준 **요청당 ≤ 2 ms** 오버헤드. 이 오버헤드는 기존 Admin HTTP 타임아웃/본문 상한(SRS `NFR-PERF-ADMIN-HTTP-001`) 산정에 영향을 주지 않는다.
- **NFR-PERF-AUDIT-WRITE-001** Audit 기록은 요청 응답 경로를 블로킹하지 않는다(비동기 큐 허용). 큐 오버플로 시 경고 로그 + 드롭 기록은 허용되지 않으며, 백프레셔로 API 가 실패하는 편을 택한다. *Why:* 증적 누락보다 명시적 실패가 안전하다.

#### 5.2.3 사용성 (숨김 UI 정책)

- **NFR-USAB-HIDE-001** 일반 유저에게 권한이 없는 UI 섹션/기능은 **숨긴다**(disable 이 아니라 hide). *Why:* "있지만 못 누르는" 혼란을 제거하고 사회공학적 권한 추측을 줄인다.
- **NFR-USAB-EMPTY-STATE-001** 숨김 처리 후 빈 화면이 되는 구간에는 "접근 권한이 없습니다" 또는 상위 랜딩으로의 리디렉션을 제공한다.
- **NFR-USAB-FIRST-LOGIN-001** 임시비번 사용자는 로그인 직후 비밀번호 변경 외 화면으로 이동할 수 없다.

#### 5.2.4 호환성 (기존 v1/v2 터널 동작 무영향)

- **NFR-COMPAT-TUNNEL-001** 본 리팩토링은 클라이언트 터널의 프로토콜(v1/v2), 데이터 채널 동작, Trusted Client 등록 스키마, controlProtocolMode 전환 정책에 영향을 주지 않는다. *Why:* 기존 운영 인스턴스가 클라이언트 재배포 없이 무중단으로 업그레이드될 수 있도록 데이터 평면 계약을 동결한다.
- **NFR-COMPAT-YAML-001** 기존 `config/server.yaml` 은 마이그레이션 1회 스키마 보정만으로 계속 사용 가능하며, 롤백 시 원본 복원이 가능하다. *Why:* 현장 수기 편집된 설정 파일의 손실 없이 업그레이드/롤백 경로를 확보해 운영 신뢰도를 유지한다.

#### 5.2.5 가시성 (Audit 로그 커버리지 100%)

- **NFR-VISI-COVERAGE-001** 관리자 API 의 CUD 엔드포인트 전수가 Audit 레코드를 생성한다(자동 테스트가 커버리지를 강제).
- **NFR-VISI-LOGIN-EVENTS-001** 로그인 성공/실패, MFA 성공/실패, 세션 강제 종료, 임시비번 발급/사용, 역할 변경, 그룹 속성 변경은 별도 이벤트 타입으로 기록된다.

---

## 6. User Stories

### 6.1 슈퍼유저 일과

> "회사에 새 운영자가 들어와서 그 사람에게 '본인 팀 터널'만 만질 수 있게 계정을 주고 싶다."

1. 슈퍼유저가 Users 화면에서 신규 사용자를 추가, 임시비번을 발급한다.
2. Groups 화면에서 해당 팀의 그룹을 확인, 속성(포트 범위 20000~20099, 프로토콜 HTTP/HTTPS, 동시 연결 50)을 검토한다.
3. 사용자를 그룹에 배정한다.
4. 임시비번을 대상자에게 전달(슈퍼유저 → 신규 운영자).
5. 며칠 뒤 Audit 화면에서 해당 사용자의 터널 생성 이력을 확인한다.

### 6.2 일반 유저 일과

> "나는 우리 팀 터널 3개만 만지는 사람이다."

1. 로그인하면 대시보드에 내 터널 3개만 보인다(다른 사용자 터널, Trusted Client, 서버 옵션, 인증서 섹션은 **숨김**).
2. 새 터널을 추가하려 하면 포트는 그룹이 허용하는 범위 내에서만 입력 가능하다.
3. 내 Audit 로그 탭에서 "어제 내가 바꾼 CORS 설정" 을 확인할 수 있다.
4. 본인 비밀번호를 변경하거나, 본인 MFA 를 등록/해제할 수 있다.

### 6.3 마이그레이션 직후 관리자 경험

> "어제까지 admin 한 계정으로 쓰던 사람."

1. 업그레이드 후 기존 admin 비밀번호로 로그인한다. **성공**.
2. UI 상단에 "당신의 계정은 슈퍼유저로 승격되었습니다" 안내 배너가 표시된다.
3. 기존 터널 설정은 그대로 보이며, 소유자가 "system(migrated)" 으로 표시된다.
4. Users/Groups 화면이 새로 보이고, 본인만이 슈퍼유저인 상태로 시작한다.
5. 팀을 추가할 생각이 없다면 그대로 쓰면 되고(기능상 동등), 팀을 나누고 싶으면 사용자·그룹을 추가한다.

### 6.4 권한 없는 유저의 UI 경험

> "일반 유저가 URL 을 직접 쳐서 `/admin/trusted-clients` 로 들어가려 한다."

1. UI 측에서 해당 라우트는 **숨김** 상태이므로 네비게이션에서 접근 경로가 없다.
2. 그럼에도 URL 직타격 시, 서버는 403(권한 없음)으로 응답한다.
3. UI 는 "접근 권한이 없습니다" + 내 대시보드로 돌아가는 링크를 보여준다.
4. Audit 로그에는 `access_denied` 이벤트가 기록된다.

---

## 7. 속성 매트릭스 (Attribute Matrix)

본 매트릭스는 11종 그룹 속성의 **정합성 기준**이다. 모든 속성은 **그룹 단위로만 부여**되며 개인 override 는 금지된다(QNA Round 3 최종).

| # | 속성 ID | 이름 | 설명 | 값 타입 | 기본값 (그룹 미지정 / 신규 그룹 기본) | 차단/제한되는 기능 |
|---|---|---|---|---|---|---|
| 1 | `tunnel_crud` | 터널 CRUD 권한 | 본인 소유 터널에 대한 Create/Read/Update/Delete 허용 여부 (이름·포트 변경 포함) | enum: `none` / `read_only` / `full` | `full` | `none`: 터널 섹션 숨김. `read_only`: 생성/수정/삭제 버튼 숨김, 편집 API 차단 |
| 2 | `max_tunnel_count` | 최대 터널 수 | 사용자당 동시 운영 가능한 터널 개수 상한. `0` = 터널 생성 금지(읽기 전용 사용자) | int ≥ 0 (`0` = 터널 생성 금지, 음수 금지) | `10` | 초과 생성 시 API 에서 거부(409). 값이 0 이면 터널 생성 UI 전체가 숨김 + Create API 403 |
| 3 | `max_tunnel_duration_ms` | 단일 터널 최대 수명 | 하나의 터널이 단일 세션으로 유지 가능한 최대 시간 (예: 12시간 = 43,200,000ms) | int ms, `0` = 무제한 | `0` (무제한) | 초과 시 서버가 자동 종료, Audit `tunnel_autoexpire` |
| 4 | `allowed_port_range` | 허용 외부 포트 범위 | 해당 그룹이 외부 포트로 바인딩 가능한 포트 범위의 합집합 | list<{from:int, to:int}> | 빈 배열 (= 외부 포트 사용 불가) | 범위 밖 포트 입력 거부(422) |
| 5 | `allowed_protocols` | 허용 터널 프로토콜 | 사용 가능한 터널 프로토콜 집합 | set<`TCP`/`HTTP`/`HTTPS`/`HTTP_REWRITE`> | 빈 집합 | 포함되지 않은 프로토콜 선택 UI 숨김, API 거부 |
| 6 | `max_concurrent_connections` | 동시 연결 수 상한 | 해당 그룹 사용자의 전체 터널 합산 동시 클라이언트 연결 수 | int ≥ 0 | `100` | 초과 연결은 거부(503) + Audit `conn_limit_hit` |
| 7 | `allowed_trusted_clients` | Trusted Client 바인딩 허용 집합 | 터널이 브리지로 사용할 수 있는 Trusted Client 의 clientId 집합 | set<string> 또는 `*`(슈퍼유저 전용) | 빈 집합 | 허용되지 않은 clientId 바인딩 시 422 |
| 8 | `http_tunnel_rewrite_permissions` | HTTP rewrite 세부 권한 | CORS/host/header/body 리라이트 개별 허용 | flags: {cors, host, header, body} | 모두 `false` | 해당 flag 가 false 면 UI 해당 섹션 숨김 + API 거부 |
| 9 | `admin_ui_section_access` | 관리 UI 섹션 접근 | 일반 유저에게 노출할 UI 섹션 | set<`tunnels`, `my_audit`, `my_profile`, `my_sessions`> | `{tunnels, my_audit, my_profile, my_sessions}` | 집합에 없는 섹션은 **숨김** |
| 10 | `tunnel_visibility` | 터널 read-only 공유 | 동일 그룹 내 다른 사용자에게 터널을 읽기 전용으로 보일지 여부 | enum: `private` / `group_read` | `private` | `group_read`: 그룹원에게 상태/설정 읽기 허용, 편집은 소유자만 |
| 11 | `rate_limit` | 대역폭 상한 | 그룹 사용자 합산 송수신 대역폭 상한. 초기 릴리스는 프리셋 4종 고정 (custom/추가 프리셋은 Out-of-scope, §11.2) | enum 프리셋(4종): `unlimited` / `1 MB/s` / `10 MB/s` / `100 MB/s` | `unlimited` | 비-`unlimited` 프리셋은 토큰 버킷으로 스로틀, 1초 평균 전송량 목표값 ±5% 이내. `unlimited` 는 버킷 바이패스 |

> **비즈니스 가치 요약**
> 속성 1·2·5·8 은 "무엇을 할 수 있는가" 를 제한(행위 제어), 3·4·6·11 은 "얼마나 쓸 수 있는가" 를 제한(자원 제어), 7 은 "누구의 트러스트를 쓸 수 있는가" 를 제한(결합 제어), 9 는 UI 노이즈 제거, 10 은 팀 내 가시성 확보다. 이 11종이 현장에서 반복되는 요구의 80/20 을 커버한다(QNA Round 2~3 수렴 결과).

**매트릭스 기본 규칙**
- 슈퍼유저는 매트릭스의 영향을 받지 않는다(모든 속성 무시, 전역 허용).
- 충돌 해결: 속성 간 충돌은 발생하지 않도록 UI 저장 시점에 검증한다(예: `allowed_protocols` 에 HTTP 가 없으면 `http_tunnel_rewrite_permissions.*` 는 모두 false 강제).
- 계산 오버헤드: 6, 11 은 런타임 카운팅 필요 → SRS `NFR-PERF-MEMBUF-001`, `NFR-PERF-POOL-QUEUE-001` 경로에 메트릭 주입.

---

## 8. 마이그레이션 플랜

### 8.1 현황

- 현재 시스템은 단일 admin + `config/.key`(bcrypt 해시) + `config/.bootstrap-token`(최초 1회) + `SessionStore` 싱글턴.
- 관리자 콘솔 HTTP 엔드포인트는 세션 쿠키 + CSRF + (일부) 백오프로 이미 강화되어 있다.
- 터널 설정은 `config/server.yaml` 에 원자적 저장(`FR-SRV-YAML-ATOMIC-001`).

### 8.2 제로다운 전략

1. **읽기 호환 단계** — 기존 스키마를 계속 읽을 수 있어야 한다. 신 필드(user/group/ownership/role)가 없으면 기본값으로 해석한다.
2. **승격 단계** — 서버 기동 시 "사용자 테이블이 비어있고 `.key` 가 존재" 하면 자동으로 `admin` 사용자 레코드를 생성해 기존 bcrypt 해시를 이전하고 역할을 `superuser` 로 설정한다. 이 과정은 **원자적**이며, 실패 시 서버는 안전하게 기존 admin 경로로 폴백한다.
3. **터널 소유권 백필** — 기존 터널에는 특수 소유자 마커 `system(migrated)` 를 부여한다. 슈퍼유저만 수정 가능하며, 일반 유저가 뒤에 들어와도 자동 재할당되지 않는다(수동 재할당만 허용).
4. **UI 호환** — 첫 승격 로그인 시 안내 배너를 노출하고, 기존 화면 구성은 그대로 보이게 한다(신규 메뉴만 추가).

### 8.3 롤백 계획

- 모든 마이그레이션은 **파일 단위 원자적 교체**로 수행하고, `.server.state.json.bak`, `server.yaml.bak` 을 같은 트랜잭션 내에서 남긴다.
- 롤백 조건: (a) 승격 후 기존 admin 이 로그인 불가, (b) 기존 터널이 부팅되지 않음, (c) Admin API 가 5xx 지속.
- 롤백 절차: 서비스 중단 없이 이전 바이너리 재실행 + `.bak` 롤백. bak 파일 자체는 슈퍼유저가 수동 정리(자동 삭제하지 않는다).
- 롤백 가능 기간: 신 릴리스 후 **14일간** `.bak` 유지 보장.

### 8.4 단계별 마일스톤 (M0~M4)

| 마일스톤 | 이름 | 산출물 | Exit 기준 |
|---|---|---|---|
| M0 | 설계 동결 | 본 PRD 승인, 속성 매트릭스 확정 | PM 사인오프 |
| M1 | 계정/그룹 뼈대 | 사용자·그룹 CRUD + 역할 + 첫 로그인 강제 변경 | 신규 사용자가 임시비번으로 로그인 → 비번 변경 → 로그인 가능 |
| M2 | 속성 집행 | 11종 속성 실행(포트·프로토콜·카운트·rate limit 포함) | Rate limit 프리셋 테스트 통과 (K4) |
| M3 | 보안 3종 | Audit, MFA, 세션 강제 종료 | Audit 커버리지 테스트 통과 (K3), MFA end-to-end 통과 |
| M4 | 마이그레이션 + 릴리스 | 자동 승격, 롤백 검증, 문서화 | 제로다운 전환 리허설 성공 (K1, K2) |

각 마일스톤은 독립적으로 배포 가능하지 않다(사용자가 있는데 속성이 안 걸리는 중간 상태는 금지). 전부 묶어서 릴리스한다.

---

## 9. 위험 & 제약

### 9.1 기술 위험

| 리스크 | 영향 | 완화 |
|---|---|---|
| R-T1 승격 중 해시 복사 실패 | admin 락아웃 | `.key` 원본 유지 + 폴백 경로 |
| R-T2 Rate limit 측정 오차 | K4 실패 | 토큰 버킷 파라미터 튜닝 + ±5% 수렴 테스트 |
| R-T3 권한 체크 오버헤드 상승 | p95 증가 | 세션 컨텍스트에 권한 스냅샷 캐싱 (TTL = 세션 TTL 이내) |
| R-T4 Audit 큐 포화 | 요청 실패 | 백프레셔 유지(드롭 금지), 큐 크기는 서버 옵션 |

### 9.2 운영 위험

| 리스크 | 영향 | 완화 |
|---|---|---|
| R-O1 마지막 슈퍼유저 삭제/MFA 키 분실 | 락아웃 | FR-USER-LAST-SUPERUSER-001 + 복구 코드 + bootstrap token 재발급 절차(서버 운영자 쉘) |
| R-O2 기존 운영자가 변경을 인지 못함 | 혼란 | 첫 로그인 배너 + 릴리스 노트 + MIGRATION.md |
| R-O3 MFA 미숙지로 인한 잠금 | 헬프데스크 폭증 | 슈퍼유저에 의한 MFA 초기화 기능 (FR-MFA-RESET-001) |

### 9.3 범위 외 드리프트 방지

- 11절(Out of Scope) 에 명시된 항목은 **코드 레벨에서도 진입하지 않는다**. 예: "IP 화이트리스트" UI 조각을 미리 만들어두는 것도 금지.
- 신규 요구가 들어오면 별도 PRD 개정 또는 후속 릴리스로 라우팅한다.

---

## 10. 의존성

- **SessionStore (SRS `FR-SRV-SESSION-SWEEP-001`, `BR-AUTH-005`)**: 단일 admin 키 모델에서 사용자 키 모델로 확장. TTL 12시간(43,200,000ms) 기본값은 유지.
- **loginBackoff (SRS `NFR-SEC-LOGIN-BACKOFF-001`)**: 로그인·MFA 실패 모두 동일 백오프 창에 합산.
- **CSRF (SRS `NFR-SEC-CSRF-001`)**: 신규 상태변경 엔드포인트 전수 적용. `/api/login`, `/api/mfa/verify` 예외 규칙 정의.
- **AdminSecurityPolicy (SRS `NFR-SEC-ADMIN-BIND-001`, `NFR-SEC-ADMIN-TLS-001`)**: loopback bind / TLS 기본 유지.
- **SecretRedactor (SRS `FR-SECRET-REDACTOR-001`)**: Audit 로그/UI 응답에도 동일 redaction 정책 적용. 평문 임시비번은 발급 응답에만 1회 노출.
- **저장소(config/*.yaml)**: 신 필드 추가(users, groups, role, ownership, audit retention, mfa enforcement). 원자적 저장 규약 유지.
- **AdminServer 엔드포인트 셋**: 사용자/그룹/세션/MFA/Audit 엔드포인트 추가. 기존 터널/서버옵션 API 는 소유자/권한 필터만 상위 미들웨어에서 얹음.

---

## 11. Out of Scope (명시)

본 리팩토링은 아래 항목을 **다루지 않는다**. 각 항목은 차기 PRD 에서 독립적으로 다뤄지거나 영구 보류된다.

### 11.1 18종 후보 속성 중 미선정 7종 (QNA Round 2에서 제외)

- IP 기반 접근 제어(사용자/그룹 IP 허용목록) — *이유:* 운영 환경이 NAT·VPN 다양, 일관성 확보 난이도 높음. *향후:* v1.2 검토.
- 터널 TLS 인증서 사용자 업로드 — *이유:* 인증서 관리의 보안 경계 재설계 필요. *향후:* 백로그(차기 PRD 분리 설계).
- 시간대/시간창 제한(업무 시간 외 금지) — *이유:* 서버 시간대 정책과 사용자 시간대 정책 분리 필요. *향후:* 백로그(v1.3+ 검토).
- 재승인(주기적 재인증) 워크플로우 — *이유:* 세션 TTL 정책과 충돌 가능성, 별도 설계 필요. *향후:* 백로그.
- 그룹 리더 위임 — *이유:* 다단 권한 계층이 범위를 폭발시킴. *향후:* 영구 보류(요구 재수집 시 재평가).
- API 토큰 발급(개인 액세스 토큰) — *이유:* 자동화 UX 는 별도 IA 가 필요. *향후:* 차기 PRD.
- 사용자별 비밀번호 정책 개별화 — *이유:* 서버 전역 정책 유지. *향후:* 영구 보류.

### 11.2 기타 명시적 제외

- 보존 기간 개별화(사용자/그룹별 Audit 보존) — 서버 전역 단일값만 제공.
- 다중 그룹 소속 / 계층(부모-자식) 그룹 — **단일 그룹 소속만 허용** (QNA Round 1 최종).
- 사용자 단위 속성 override — **금지** (QNA Round 3 최종).
- Trusted Client 의 사용자 소유화 — **서버 전역(server-wide) 유지** (QNA Round 2 최종).
- UI 전면 재디자인 — 권한 기반 숨김/뷰 추가 외 레이아웃 변경 없음.
- SSO / OIDC / LDAP 연동 — 본 릴리스 범위 외.

---

## 12. Open Questions & Assumptions

> PM/사용자 확인이 필요한 미해결 사항. 각 항목은 합의 전까지 가정(Assumption)으로 진행한다.

| # | 질문 | 현재 가정 | 확인 필요 대상 | 확정 기한 |
|---|---|---|---|---|
| Q1 | MFA 강제 토글의 기본값은 무엇인가? | 슈퍼유저 MFA 강제 = **off** (Opt-in). 기본값을 on 으로 할지 합의 필요. | 보안팀 | M3 Exit 전 |
| Q2 | 임시비번 전달 채널은 명시하지 않는가? | PRD 는 전달 채널을 정의하지 않음(운영 정책 위임). UI 에서만 1회 노출. | 운영팀 | M1 Exit 전 |
| Q3 | Audit 보존 기간 상한은? | 기본 90일, 상한 없음. 상한을 서버 옵션으로 강제할지 합의 필요. | PM | M0 동결 전 |
| Q4 | 일반 유저가 본인 MFA 를 해제할 수 있는가 (슈퍼유저가 on 을 강제하지 않은 경우)? | 가정: 가능. | 보안팀 | M3 Exit 전 |
| Q5 | 슈퍼유저가 다른 슈퍼유저의 세션을 강제 종료할 수 있는가? | 가정: 가능. 단, 본인 슈퍼유저 세션 강제 종료는 허용. | PM | M0 동결 전 |
| Q6 | 첫 승격 시 "legacy admin" 사용자의 표시 이름은 고정("admin") 인가, 편집 가능한가? | 가정: 편집 가능. | UX | M4 시작 전 |
| Q7 | `system(migrated)` 소유 터널을 일반 유저 소유로 재할당 가능한가? | 가정: 슈퍼유저만 가능. 재할당 행위는 Audit 기록. | PM | M4 시작 전 |

---

## Appendix A. 권한 결정 매트릭스 예시 (Role × Section × Action)

> 예시일 뿐, 정합성의 정답은 5·7절이다. 본 부록은 이해를 돕는 스냅샷.

| Section | Action | 슈퍼유저 | 일반 유저 (소유) | 일반 유저 (타인/전역) |
|---|---|---|---|---|
| Users | Create | 허용 | 숨김 | 숨김 |
| Users | Read | 허용 (전체) | 본인만 | 숨김 |
| Users | Update role | 허용 | 숨김 | 숨김 |
| Groups | Create / Update / Delete | 허용 | 숨김 | 숨김 |
| Tunnels | Create | 허용 | 속성 범위 내 허용 | 숨김 |
| Tunnels | Update / Delete | 허용 | 본인 소유만 | 숨김 |
| Tunnels | Read | 허용 (전체) | 본인 소유 + `group_read` 설정 시 그룹원 | 숨김 |
| Trusted Clients | Manage | 허용 | 숨김 | 숨김 |
| Server Options | Update | 허용 | 숨김 | 숨김 |
| Admin Cert | Manage | 허용 | 숨김 | 숨김 |
| Audit Log | Read | 허용 (전체) | 본인 이벤트만 | 숨김 |
| Sessions | List / Kill others | 허용 | 숨김 | 숨김 |
| Sessions | Kill self | 허용 | 허용 | - |
| MFA | Enroll / Disable self | 허용 | 허용 | - |
| MFA | Reset others | 허용 | 숨김 | 숨김 |

---

## Appendix B. 용어집

- **슈퍼유저(Super User)** — 전역 관리자. 11종 속성 제약을 받지 않음. 최소 1명 유지.
- **일반 유저(Regular User)** — 단일 그룹에 속한 운영자. 속성 범위 내에서만 행위 가능.
- **그룹(Group)** — 속성 부여 단위. 사용자는 정확히 하나의 그룹에 속함.
- **속성(Attribute)** — 그룹에 부여되어 사용자의 행위/자원 한도를 결정하는 선언적 설정 (11종).
- **소유자(Owner)** — 터널 리소스의 생성자(사용자). 마이그레이션 터널은 `system(migrated)` 로 표기.
- **Audit 이벤트** — 관리 API CUD 호출 및 주요 인증 이벤트의 구조화 기록. 기본 90일 보존.
- **임시 비밀번호(Temp password)** — 슈퍼유저가 발급하는 1회용 초기 비밀번호. 첫 로그인 시 강제 변경.
- **세션 강제 종료(Force Logout)** — 슈퍼유저가 특정 세션/사용자의 모든 세션을 즉시 무효화하는 행위.
- **숨김(Hide) UI 정책** — 권한 없는 UI 요소를 disable 이 아닌 비노출 처리.

---

## Appendix C. 참고 문서 / Traceability

### C.1 참고 문서

- 본 프로젝트 SRS: [docs/plan/srs/TTTGate.md](../srs/TTTGate.md)
- Phase 2 Admin Surface Lockdown: [docs/plan/02.phase-2-admin-surface-lockdown.md](../02.phase-2-admin-surface-lockdown.md)
- Phase 2-1 Admin Legacy Migration: [docs/plan/02-1.admin-legacy-migration.md](../02-1.admin-legacy-migration.md)
- Phase 4 Control Plane Trust: [docs/plan/04.phase-4-control-plane-trust-and-protocol-v2.md](../04.phase-4-control-plane-trust-and-protocol-v2.md)
- QNA 수렴 결과: `.snoworca/prd-qna/TTTGate-admin-rbac/qna.json`

### C.2 SRS → PRD Traceability

| SRS REQ-ID | 내용 | 본 PRD 에서의 관계 |
|---|---|---|
| `BR-AUTH-006` | 명시적 로그아웃 엔드포인트 부재 | **FR-LOGOUT-001** 로 해소 |
| `BR-AUTH-005` | 관리자 세션 TTL 12시간(43,200,000ms) | 유지(NFR-SEC-PRESERVE-001). 신규 FR-SESSION-* 가 추가 경로로 동작 |
| `NFR-SEC-CSRF-001` | CSRF double-submit | 신규 엔드포인트 전수 적용 (NFR-SEC-NEW-ENDPOINT-CSRF-001) |
| `NFR-SEC-LOGIN-BACKOFF-001` | 지수 백오프 | MFA 실패에도 동일 창 합산 (NFR-SEC-NEW-ENDPOINT-BACKOFF-001) |
| `NFR-SEC-BCRYPT-001` | bcrypt cost 12 | 유지. 임시비번도 동일 해시 |
| `NFR-SEC-ADMIN-BIND-001` | Admin Loopback Bind | 유지 |
| `NFR-SEC-ADMIN-TLS-001` | Admin TLS 강제 | 유지 |
| `NFR-SEC-SESSION-COOKIE-001` | 세션 쿠키 보안 속성 | 유지 |
| `FR-SRV-BOOTSTRAP-GEN-001` | bootstrap token 생성/소비 | 재사용(최초 슈퍼유저 초기화 경로) |
| `FR-SRV-SESSION-SWEEP-001` | 세션 만료 sweep | 다사용자 세션으로 확장(행위는 동일) |
| `FR-SRV-AUDIT-LOG-001` | 런타임 로거 | 구조화 Audit 로그(FR-AUDIT-*)로 별도 계층 추가 |
| `FR-SRV-YAML-ATOMIC-001` | server.yaml 원자적 저장 | 유지. 스키마 확장 시에도 원자성 유지 |
| `FR-SECRET-REDACTOR-001` | 민감정보 redact | 임시비번/복구코드 응답 전수 redact 대상 |
| `NFR-PERF-ADMIN-HTTP-001` | Admin HTTP 타임아웃/본문 상한 | 본 PRD 에서 악화시키지 않음 (NFR-PERF-PERMCHECK-001 보증) |

---

_문서 끝. 다음 단계: 본 PRD 사인오프 → SRS 증분 작성(`snoworca-srs`) → 구현 계획(`snoworca-planner`)._

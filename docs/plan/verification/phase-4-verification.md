# Phase 4 검증 문서

## 완료 체크리스트

- [x] verified TLS 기본값 적용
- [x] authenticated client identity 도입
- [x] proof-of-possession 적용
- [x] handshake state/packet ID invariant 검증 적용
- [x] data channel binding 적용
- [x] protocol v2 negotiation 적용

## 테스트 결과

- v1/v2 matrix: ✅ `test/component/server/ProtocolV2.test.ts`, `test/e2e/tunnel/baseline-tunnel.test.ts`
- MITM reject: ✅ `test/component/client/TlsVerification.test.ts`
- spoof identity reject: ✅ `test/component/server/ProtocolV2.test.ts`
- replay attach reject: ✅ `test/component/server/ProtocolV2.test.ts`
- invalid challenge/PoP reject: ✅ `test/component/server/ProtocolV2.test.ts`
- invalid packet ID/state reject: ✅ `test/component/server/ProtocolV2.test.ts`

## 품질 평가

- 신뢰 경계 복구: ✅ `clientId` + PoP + binding token 경로 동작
- 호환성 마이그레이션: ✅ `legacy`/`mixed`/`mtls-strict`, `allowLegacyControlAuth`, `allowLegacyFallback`, `wide-id` 경로 반영
- 문서화 수준: ✅ Phase 4A 증적 기록

## 이슈

- 없음

## 회귀 결과

- [x] 승인된 조합에서 정상 연결 유지
- [x] legacy mode 제한적 동작 검증
- [x] PoP와 state invariant 위반 시 100% 거부

## 승인 체크리스트

- [x] 다음 Phase 진입 승인

## 명령 결과

- `npm run build` 성공
- `npm test -- --runInBand` 성공
- 전체 회귀: `20 suites / 52 tests passed`

## 증적

- [Phase 4A 증적](./evidence/hardened/phase-4/2026-04-20-phase-4a.md)

# 2026-04-19 Phase 1 Red Candidate 목록

Phase 1에서는 아래 exploit regression을 의도적으로 CI 녹색 세트에 넣지 않는다. 현재 구현에서는 실패가 아니라 성공할 수 있기 때문이다. 대신 어떤 정상 계약을 보존해야 하는지와 어느 phase에서 red -> green 전환할지를 고정한다.

| ID | 취약 동작 | 보존해야 하는 주변 정상 계약 | 예정 Phase | 예정 테스트 이름 |
|----|----------|-----------------------------|-----------|------------------|
| RED-ADMIN-1 | `../` 기반 정적 파일 경로 탈출 | `/`는 `index.html`을 반환하고, 존재하지 않는 파일은 `404` | Phase 2 | `security/admin/path-traversal.reject.test.ts` |
| RED-ADMIN-2 | 원격 first-login bootstrap 선점 | 정상 로그인은 세션 쿠키를 발급하고 `/api/validateSession`이 통과 | Phase 2 | `security/admin/remote-bootstrap.reject.test.ts` |
| RED-ADMIN-3 | insecure admin bind/TLS 기본값 | 기존 설정 로드와 admin API 응답 포맷은 유지 | Phase 2 | `security/admin/secure-defaults.test.ts` |
| RED-CTRL-1 | 공개 기본 key로 control channel 등록 | 정상 server-client control 연결과 echo tunnel 유지 | Phase 4 | `security/control/default-key.reject.test.ts` |
| RED-CTRL-2 | TLS 인증서 미검증 연결 허용 | 정상 TLS 옵션 builder 경로와 connect contract 유지 | Phase 4 | `security/control/untrusted-cert.reject.test.ts` |
| RED-CTRL-3 | self-declared client name spoofing | 정상 authenticated client 등록 후 session open | Phase 4 | `security/control/spoofed-client-identity.reject.test.ts` |
| RED-CTRL-4 | data handler attach mismatch / replay | 정상 data handler bind 후 echo tunnel 유지 | Phase 4 | `security/control/data-attach-mismatch.reject.test.ts` |
| RED-RES-1 | pending queue 무제한 성장 | 정상 slow receiver와 small payload tunnel 흐름 유지 | Phase 3 | `security/resource/pending-queue.cap.test.ts` |
| RED-RES-2 | handshake deadline 부재 | 정상 reconnect와 delayed network connect 유지 | Phase 3 | `security/resource/handshake-timeout.test.ts` |
| RED-OPS-1 | `-reset false`가 파괴적으로 reset | 정상 CLI option parse와 save/load roundtrip 유지 | Phase 5 | `security/ops/reset-false.noop.test.ts` |

## 운영 규칙

- 위 목록은 TODO나 skip test 대신 Phase 2+ 구현 전환의 입력 문서다.
- 실제 테스트 파일은 해당 phase 진입 직전에 추가하고, 추가 즉시 red 상태를 확인한 뒤 구현으로 green 전환한다.

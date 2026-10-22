# #36 종료 본문 초안

Status: root 게시·종료 완료. GitHub comment 5578464411, CLOSED 2026-09-08T03:03:56Z; Telegram receipt 3963 (66/35). 아래는 게시된 종료 근거의 보존 기록입니다.

인증서 key/cert/CA 파일명을 경로 구성 전에 검사하도록 수정했습니다. 신규 입력뿐 아니라 기존 저장 이름도 snapshot·쓰기·삭제·compound 저장에서 검증하며, 부적합한 이름은 400으로 거부합니다. 정상 Unicode·공백·점이 있는 basename과 선택적 빈 CA를 유지합니다.

- 소스: `d251db1`
- 통합: `7a79df4bafd2789b105e288368391dad314568c5`
- TDD: 구현 전 8개 RED 확인. 작성자 관련 28개 회귀 PASS 및 정상 Unicode 파일 쓰기·삭제 추가 1개 PASS.
- 독립 검토: 두 리뷰 모두 지적 없이 PASS. 한 리뷰어의 별도 선택 실행은 2개 PASS/9개 필터 제외이며 전체 회귀로 주장하지 않습니다.
- 통합 검증: 실행 57186이 자연 exit 0으로 종료했으며 5 suites / 29 tests PASS, 174.724초. 강제 build PASS. Push 완료 후 `ls-remote`가 위 통합 hash와 일치함을 root가 확인했습니다.

이 변경은 파일명의 lexical 검사입니다. symlink/junction을 포함한 파일시스템 경로 containment를 보장하는 변경은 아닙니다. 기존 unsafe metadata를 자동 축약·이동·삭제하지 않으며, 필요한 수동 정정 절차는 `docs/guide/certificate-filenames.md`에 안내했습니다. 인증·CSRF·revision 및 PEM 검증 정책은 유지합니다.

- [x] 통합 회귀 결과·자연 종료와 push/remote hash 확인 반영. Status: 완료.
- [x] Independent body review and root publication/closure. Status: complete; comment 5578464411, CLOSED 2026-09-08T03:03:56Z; root Telegram receipt 3963 (66/35).

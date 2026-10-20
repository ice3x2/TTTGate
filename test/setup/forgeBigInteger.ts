/**
 * jest 의 node 환경은 Node 21+ 의 전역 navigator 를 테스트 전역에 복사한다. node-forge 의 jsbn 은 navigator 가 있으면
 * 브라우저로 보고 am1 곱셈을 고르는데(node_modules/node-forge/lib/jsbn.js), jest 의 격리 환경 안에서 am1 은 약 40배
 * 느려 RSA 서명·복호화 한 번이 1초를 넘는다. 그동안 이벤트 루프가 멈춰 수 초 기한을 단언하는 테스트가 흔들린다(#194).
 * 테스트 모듈을 불러오기 전에 지워 Node 용 am3 를 쓰게 한다. 운영 런타임(일반 Node)에서는 같은 연산이 빠르다.
 */
delete (globalThis as {navigator?: unknown}).navigator;

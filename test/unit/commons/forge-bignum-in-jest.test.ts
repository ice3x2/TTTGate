import forge from "node-forge";

// #194: jest 의 node 환경은 Node 21+ 의 전역 navigator 를 복사한다. node-forge 의 jsbn 은 navigator 가 있으면
// 브라우저로 보고 am1 곱셈을 고르는데, jest 안에서 am1 은 약 40배 느려 RSA 연산 한 번이 1초를 넘고 그동안
// 이벤트 루프가 멈춘다. 테스트 설정이 navigator 를 지워 Node 용 am3 를 쓰게 하는지 고정한다.
describe("node-forge big integer inside jest", () => {
    test("uses the Node multiplication routine (am3)", () => {
        expect((forge as any).jsbn.BigInteger.prototype.am.name).toBe("am3");
    });
});

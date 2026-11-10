import AdminServer from "../../../../src/server/admin/AdminServer";

// 이슈 349 FR-7 — 실패 응답의 payload 에는 화면이 문구에 끼울 값 필드가 섞인다. 어떤 필드도 success 를 덮지 못한다.
describe("AdminServer.sendApiFailure", () => {
    const send = (payload: object): Record<string, unknown> => {
        const res = {writeHead: jest.fn(), end: jest.fn()};
        const server = AdminServer.prototype as unknown as {sendApiFailure(res: unknown, status: number, payload: object): void};
        server.sendApiFailure.call(AdminServer.prototype, res, 422, payload);
        expect(res.writeHead).toHaveBeenCalledWith(422, expect.anything());
        return JSON.parse(res.end.mock.calls[0][0]);
    };

    test("payload 에 success 가 있어도 응답은 실패다", () => {
        expect(send({code: "x_y", message: "m", success: true})).toMatchObject({success: false, code: "x_y", message: "m"});
    });

    test("값 필드는 그대로 응답에 실린다", () => {
        expect(send({code: "x_y", message: "m", port: 8080})).toMatchObject({success: false, code: "x_y", port: 8080});
    });

    // 리뷰 M-1: 값 필드는 어느 경로로 오든 sendApiFailure 한 곳에서 거른다.
    test("값 필드의 긴 문자열은 100자로 자르고, 객체 값은 뺀다", () => {
        const body = send({code: "x_y", message: "m", address: "a".repeat(300), detail: {nested: true}});
        expect(body.address).toBe("a".repeat(100));
        expect(body).not.toHaveProperty("detail");
    });

    test("values 로 넘긴 값도 같은 규칙으로 거르고, values 필드 자체는 응답에 싣지 않는다", () => {
        const body = send({code: "x_y", message: "m", values: {address: "b".repeat(300), detail: {nested: true}, port: 80}});
        expect(body).toMatchObject({address: "b".repeat(100), port: 80});
        expect(body).not.toHaveProperty("detail");
        expect(body).not.toHaveProperty("values");
    });

    test("값이 아닌 응답 필드는 거르지 않는다", () => {
        const revisionState = {revision: 3, digest: "c".repeat(200)};
        const references = [{kind: "tunnel", id: "8080"}];
        const url = "/" + "d".repeat(200);
        const body = send({code: "x_y", message: "m".repeat(200), revisionState, references, url, failedScopes: ["server"], partial: true});
        expect(body).toMatchObject({message: "m".repeat(200), revisionState, references, url, failedScopes: ["server"], partial: true});
    });

    // 리뷰 L-1: values 의 키는 봉투·응답 필드를 덮지 못한다.
    test("values 에 응답 필드 이름이 있으면 그 키는 버린다", () => {
        const body = send({code: "x_y", message: "m", values: {
            success: true, partial: true, failedScopes: ["x"], warnings: ["w"], code: "evil", message: "evil", updated: true, port: 1}});
        expect(body).toEqual({success: false, partial: false, failedScopes: [], warnings: [], code: "x_y", message: "m", port: 1});
    });
});

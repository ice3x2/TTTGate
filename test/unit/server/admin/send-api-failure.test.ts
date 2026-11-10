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
});

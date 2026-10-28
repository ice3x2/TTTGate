import {getFreePort} from "../../../helpers/network";

/** 관리 API 로 빈 포트에 tcp 터널을 하나 추가한다. extra 로 옵션을 덧붙인다. */
export const addTunnel = async (f: any, extra: Record<string, unknown> = {}) => {
    const port = await getFreePort();
    const option = {forwardPort: port, protocol: "tcp", tls: false, destinationAddress: "127.0.0.1", destinationPort: 9, keepAlive: 0, ...extra};
    const read = await f.snapshot();
    expect((await f.request("POST", "/api/tunnelingOption", {...option, expectedRevision: read.revisionState.currentRevision})).statusCode).toBe(200);
    return {port, option};
};

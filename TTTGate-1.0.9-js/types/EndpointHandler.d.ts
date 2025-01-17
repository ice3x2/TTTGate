import { SocketHandler } from "../util/SocketHandler";
import HttpHandler from "../server/http/HttpHandler";
type EndPointInfo = {
    closeWait?: boolean;
    lastSendTime?: number;
    endLength?: number;
    sessionID?: number;
    protocolType?: 'http' | 'tcp';
};
type EndpointHandler = SocketHandler & EndPointInfo;
type EndpointHttpHandler = HttpHandler & EndPointInfo;
export { EndpointHandler, EndpointHttpHandler, EndPointInfo };

"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
var SocketState;
(function (SocketState) {
    /**
     *  연결되지 않음. 대기상태
     */
    SocketState[SocketState["None"] = 0] = "None";
    SocketState[SocketState["Connected"] = 1] = "Connected";
    SocketState[SocketState["TryEnd"] = 2] = "TryEnd";
    SocketState[SocketState["End"] = 3] = "End";
    SocketState[SocketState["Closed"] = 4] = "Closed";
    SocketState[SocketState["Receive"] = 5] = "Receive";
    SocketState[SocketState["Bound"] = 6] = "Bound";
    SocketState[SocketState["Listen"] = 7] = "Listen";
    SocketState[SocketState["Starting"] = 8] = "Starting";
})(SocketState || (SocketState = {}));
exports.default = SocketState;

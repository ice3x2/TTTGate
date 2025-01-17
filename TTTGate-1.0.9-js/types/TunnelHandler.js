"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CtrlState = exports.HandlerType = exports.DataHandlerState = void 0;
var CtrlState;
(function (CtrlState) {
    CtrlState[CtrlState["Connected"] = 0] = "Connected";
    CtrlState[CtrlState["Syncing"] = 1] = "Syncing";
})(CtrlState || (exports.CtrlState = CtrlState = {}));
var DataHandlerState;
(function (DataHandlerState) {
    DataHandlerState[DataHandlerState["None"] = 0] = "None";
    DataHandlerState[DataHandlerState["Initializing"] = 1] = "Initializing";
    DataHandlerState[DataHandlerState["ConnectingEndPoint"] = 2] = "ConnectingEndPoint";
    DataHandlerState[DataHandlerState["OnlineSession"] = 3] = "OnlineSession";
    DataHandlerState[DataHandlerState["Terminated"] = 4] = "Terminated"; /** 종료됨 */
})(DataHandlerState || (exports.DataHandlerState = DataHandlerState = {}));
var HandlerType;
(function (HandlerType) {
    HandlerType[HandlerType["Control"] = 0] = "Control";
    HandlerType[HandlerType["Data"] = 1] = "Data";
    HandlerType[HandlerType["Unknown"] = 2] = "Unknown";
})(HandlerType || (exports.HandlerType = HandlerType = {}));

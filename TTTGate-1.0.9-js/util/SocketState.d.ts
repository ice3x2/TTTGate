declare enum SocketState {
    /**
     *  연결되지 않음. 대기상태
     */
    None = 0,
    Connected = 1,
    TryEnd = 2,
    End = 3,
    Closed = 4,
    Receive = 5,
    Bound = 6,
    Listen = 7,
    Starting = 8
}
export default SocketState;

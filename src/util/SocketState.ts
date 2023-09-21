enum SocketState {
    /**
     *  연결되지 않음. 대기상태
     */
    None,
    Connected, // 연결됨, 연결된 상태에서는 데이터를 주고받을 수 있음.
    TryEnd, // 연결을 끊으려고 시도중.
    End, // 연결이 끊어짐. 연결이 끊어진 상태에서는 데이터를 주고받을 수 없음. 남아있는 버퍼는 마저 전송됨.
    Closed, // 소켓이 닫힘. 소켓이 닫힌 상태에서는 데이터를 주고받을 수 없음.

    Receive, // 데이터 읽는중
    Bound, // 소켓 바인딩
    Listen, // 서버 소켓 리스닝
    Starting

}





export default SocketState;


enum SessionState {
    None ,
    HalfOpened , // ExternalPortServer -> Session.ts ; ExternalPort 서버에만 연결이 된 상태
    Handshaking ,
    Connected ,
    Receive ,
    End,
    Closed
}

export default SessionState;
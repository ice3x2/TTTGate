

enum SessionState {
    None ,
    HalfOpened ,
    Handshaking ,
    Connected ,
    Receive ,
    End,
    Closed
}

export default SessionState;
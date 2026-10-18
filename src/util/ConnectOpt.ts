

type ConnectOpt = {
    host : string;
    port : number;
    tls? : boolean;
    ca? : string;
    cert? : string;
    key? : string;
    serverName?: string;
    rejectUnauthorized?: boolean;
    keepalive? : number
    timeout? : number;
    /** 연결(TCP 연결과 TLS 핸드셰이크)이 끝나야 하는 기한(ms). 넘으면 소켓을 닫아 연결 실패로 처리한다(#179). */
    connectTimeout? : number;
}

export default ConnectOpt;

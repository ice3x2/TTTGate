import net from "net";
import * as tls from "tls";
import ConnectOpt from "./ConnectOpt";

type ServerTlsConfig = {
    port: number;
    tls?: boolean;
    ca?: string;
    cert?: string;
    key?: string;
    keepAlive?: number;
}

type TlsOptionsFactory = {
    createClientSocketOptions(options: ConnectOpt): net.NetConnectOpts | tls.ConnectionOptions;
    createServerTlsOptions(options: ServerTlsConfig): tls.TlsOptions;
}

const MIN_KEEP_ALIVE = 500;

const DefaultTlsOptionsFactory: TlsOptionsFactory = {
    createClientSocketOptions(options: ConnectOpt): net.NetConnectOpts | tls.ConnectionOptions {
        const socketOptions: any = {
            port: options.port,
            host: options.host,
            allowHalfOpen: false,
            keepAlive: (options.keepalive ?? 60000) > 0,
            keepAliveInitialDelay: Math.max(options.keepalive ?? 60000, MIN_KEEP_ALIVE),
            noDelay: true,
            rejectUnauthorized: options.rejectUnauthorized !== false
        };

        if(options.ca) {
            socketOptions.ca = options.ca;
        }
        if(options.cert) {
            socketOptions.cert = options.cert;
        }
        if(options.key) {
            socketOptions.key = options.key;
        }
        if(options.serverName) {
            socketOptions.servername = options.serverName;
        }

        return socketOptions;
    },
    createServerTlsOptions(options: ServerTlsConfig): tls.TlsOptions {
        // P3-T2 / REQ-02: secureProtocol(= 단일 메서드 고정) 제거.
        //   - 단일 method 고정은 TLS 1.3 협상 불가 + 향후 취약 프로토콜 혼입 위험.
        //   - OpenSSL 권장 방식인 minVersion/maxVersion 범위 + ciphers 화이트리스트로 교체.
        //
        // 정책:
        //   minVersion = TLSv1.2   (TLS 1.0/1.1 거부)
        //   maxVersion = TLSv1.3   (최신까지 허용, 기본 TLS 1.3 cipher)
        //   ciphers    = ECDHE-AEAD only (TLS 1.2 경로). TLS 1.3 ciphersuites는
        //                Node/OpenSSL 기본값을 사용한다(별도 API tls13Ciphers 필요).
        //   honorCipherOrder = true (서버 선호 순서 강제)
        //
        // 주의 (TLS 1.3 한계):
        //   `ciphers` / `honorCipherOrder` 옵션은 **TLS 1.2 이하에만 적용**된다. TLS 1.3 협상 시
        //   Node 기본 ciphersuites(TLS_AES_256_GCM_SHA384, TLS_AES_128_GCM_SHA256,
        //   TLS_CHACHA20_POLY1305_SHA256)가 사용되며, 아래 ciphers 리스트는 무시된다.
        //   TLS 1.3 suite를 명시적으로 제어하려면 tls.DEFAULT_CIPHERS 전역 설정 또는
        //   `ciphersuites`(Node 내장 API / OpenSSL `-ciphersuites`) 옵션을 별도로 사용해야 한다.
        const tlsOptions: tls.TlsOptions = {
            key: options.key,
            cert: options.cert,
            minVersion: "TLSv1.2",
            maxVersion: "TLSv1.3",
            honorCipherOrder: true,
            // TLS 1.2 ECDHE + AEAD(GCM/CHACHA20) 화이트리스트.
            // 취약 cipher(RC4, 3DES, CBC-legacy, DSS, anon, NULL, EXPORT)를 명시적으로 배제한다.
            ciphers: [
                "ECDHE-ECDSA-AES256-GCM-SHA384",
                "ECDHE-RSA-AES256-GCM-SHA384",
                "ECDHE-ECDSA-CHACHA20-POLY1305",
                "ECDHE-RSA-CHACHA20-POLY1305",
                "ECDHE-ECDSA-AES128-GCM-SHA256",
                "ECDHE-RSA-AES128-GCM-SHA256"
            ].join(":")
        };

        if(options.ca) {
            tlsOptions.ca = options.ca;
        }

        return tlsOptions;
    }
};

let activeTlsOptionsFactory: TlsOptionsFactory = DefaultTlsOptionsFactory;

const TlsOptionsFactoryRegistry = {
    current(): TlsOptionsFactory {
        return activeTlsOptionsFactory;
    },
    configure(factory: TlsOptionsFactory): void {
        activeTlsOptionsFactory = factory;
    },
    reset(): void {
        activeTlsOptionsFactory = DefaultTlsOptionsFactory;
    }
};

export { DefaultTlsOptionsFactory, ServerTlsConfig, TlsOptionsFactory, TlsOptionsFactoryRegistry };

import bcrypt from 'bcryptjs';
import Environment from "../../Environment";
import File from "../../util/File"
import Files from "../../util/Files";
import {ClockRngProvider} from "../../util/ClockRng";
import crypto, {createHash} from "crypto";
import fs from "fs";
import fsp from "fs/promises";
import {timingSafeStringEqual} from "../../util/timingSafeStringEqual";

import LoggerFactory  from "../../util/logger/LoggerFactory";
const logger = LoggerFactory.getLogger('server', 'SessionStore');

type Session = {
    key: string;
    timeout: number;
}

const DEFAULT_TIMEOUT = 1000 * 60 * 60 * 12; // 12 hours
const KEY_FILE_NAME = '.key';
const BOOTSTRAP_TOKEN_FILE_NAME = ".bootstrap-token";
const MIN_PASSWORD_LENGTH = 8;

type LoginResult = {
    success: boolean;
    bootstrapRequired: boolean;
    invalidBootstrapToken: boolean;
    weakPassword: boolean;
    migratedLegacyHash: boolean;
}

class SessionStore {
    private static _instance: SessionStore;
    private _sessions: Map<string, Session> = new Map<string, Session>();
    private _key : string = '';
    private _bootstrapToken: string = "";

    private constructor() {
        this.loadKey();
        this.ensureBootstrapState();
    }

    public static get instance(): SessionStore {
        if (!SessionStore._instance) {
            SessionStore._instance = new SessionStore();
        }
        return SessionStore._instance;
    }

    public static resetForTest(): void {
        SessionStore._instance = undefined as any;
    }

    private now(): number {
        return ClockRngProvider.current().now();
    }

    private random(): number {
        return ClockRngProvider.current().random();
    }

    private  loadKey() {
        let keyFile = new File(Environment.path.configDir, KEY_FILE_NAME);
        if(keyFile.exists()) {
            let key = Files.toStringSync(keyFile);
            if(key) {
                this._key = key.trim();
            }
        }
    }

    public async isEmptyKey() {
        return this._key == '';
    }

    public async newSession() : Promise<string>  {
        let now = this.now();
        let sessionKey = crypto.randomBytes(64).toString("hex");
        this._sessions.set(sessionKey, {key: sessionKey, timeout: now + DEFAULT_TIMEOUT});
        return sessionKey;
    }

    public async removeSession(sessionKey: string) : Promise<void> {
        this._sessions.delete(sessionKey);
    }

    public sweepSession() : void {
        // P5-T5 / REQ-16: forEach → for...of 로 반복 변경.
        // forEach 는 async/await 를 무시하므로 비동기 안전성이 낮다.
        const now = this.now();
        for(const [key, session] of this._sessions) {
            if(session.timeout < now) {
                this._sessions.delete(key);
            }
        }
    }


    public async isSessionValid(sessionKeyList: Array<string>) : Promise<boolean> {
        // P5-T5 / REQ-16: forEach → for...of 전환으로 비동기 컨트롤 흐름 안전 확보.
        let valid = false;
        for(const sessionKey of sessionKeyList) {
            const session = this._sessions.get(sessionKey);
            if(!session) continue;
            const now = this.now();
            if(session.timeout > now) {
                session.timeout = now + DEFAULT_TIMEOUT;
                valid = true;
            } else {
                this._sessions.delete(sessionKey);
            }
        }
        return valid;
    }

    /**
     * P5-T5 / REQ-16: Cookie 파싱 방어용 헬퍼.
     * split('=') 대신 indexOf('=')로 첫 분리자만 사용한다. 값에 '='가 포함된 쿠키
     * (예: base64url 패딩이 남은 토큰 `sid=abc=xy`)도 `abc=xy` 그대로 추출 가능.
     */
    public static parseCookieHeader(header: string | undefined): Map<string, string> {
        const result = new Map<string, string>();
        if(header == undefined) return result;
        const parts = header.split(';');
        for(const raw of parts) {
            const seg = raw.trim();
            if(seg.length == 0) continue;
            const eq = seg.indexOf('=');
            if(eq <= 0) continue;
            const key = seg.substring(0, eq).trim();
            const value = seg.substring(eq + 1).trim();
            if(key.length == 0) continue;
            if(!result.has(key)) {
                result.set(key, value);
            }
        }
        return result;
    }


    public async login(key : string, bootstrapToken?: string): Promise<boolean> {
        return (await this.loginWithDetails(key, bootstrapToken)).success;
    }

    public async loginWithDetails(key: string, bootstrapToken?: string): Promise<LoginResult> {
        const password = typeof key == "string" ? key.trim() : "";
        if(this._key == "") {
            if(!this.isStrongPassword(password)) {
                return {success: false, bootstrapRequired: true, invalidBootstrapToken: false, weakPassword: true, migratedLegacyHash: false};
            }
            if(!this.isBootstrapTokenValid(bootstrapToken)) {
                return {success: false, bootstrapRequired: true, invalidBootstrapToken: true, weakPassword: false, migratedLegacyHash: false};
            }
            const hashedPassword = await bcrypt.hash(password, 12);
            const persisted = await this.persistPasswordHash(hashedPassword);
            if(!persisted) {
                return {success: false, bootstrapRequired: true, invalidBootstrapToken: false, weakPassword: false, migratedLegacyHash: false};
            }
            await this.clearBootstrapToken();
            return {success: true, bootstrapRequired: false, invalidBootstrapToken: false, weakPassword: false, migratedLegacyHash: false};
        }

        const verifyResult = await this.verifyPassword(password);
        if(!verifyResult.success) {
            return {success: false, bootstrapRequired: false, invalidBootstrapToken: false, weakPassword: false, migratedLegacyHash: false};
        }
        if(verifyResult.migrateToBcrypt) {
            const migrated = await this.persistPasswordHash(await bcrypt.hash(password, 12));
            if(!migrated) {
                return {success: false, bootstrapRequired: false, invalidBootstrapToken: false, weakPassword: false, migratedLegacyHash: false};
            }
            return {success: true, bootstrapRequired: false, invalidBootstrapToken: false, weakPassword: false, migratedLegacyHash: true};
        }
        return {success: true, bootstrapRequired: false, invalidBootstrapToken: false, weakPassword: false, migratedLegacyHash: false};
    }

    // noinspection DuplicatedCode
    private hashPassword(password: string) : string {
        password = password.trim() + '@';
        let salt : string = '';
        for(let i =0; i < password.length; i++) {
            salt += Math.round(password.charCodeAt(i) / 2).toString(16);
        }
        return createHash('sha512').update(password + salt).digest('hex');
    }

    private ensureBootstrapState(): void {
        if(this._key.length > 0) {
            this.removeBootstrapTokenFile();
            this._bootstrapToken = "";
            return;
        }

        const tokenFile = new File(Environment.path.configDir, BOOTSTRAP_TOKEN_FILE_NAME);
        if(tokenFile.isFile()) {
            const token = Files.toStringSync(tokenFile)?.trim();
            if(token && token.length > 0) {
                this._bootstrapToken = token;
                this.secureFile(tokenFile);
                return;
            }
        }

        this._bootstrapToken = crypto.randomBytes(32).toString("hex");
        this.writeSecureFileSync(tokenFile, this._bootstrapToken);
        logger.warn(`Bootstrap token created at ${tokenFile.toString()}`);
    }

    private isStrongPassword(password: string): boolean {
        return password.trim().length >= MIN_PASSWORD_LENGTH;
    }

    private isBootstrapTokenValid(token?: string): boolean {
        if(this._bootstrapToken.length == 0) {
            return false;
        }
        if(typeof token != "string") {
            return false;
        }
        // P3-T4 / REQ-04: 부트스트랩 토큰 비교를 timingSafeStringEqual로 일원화.
        return timingSafeStringEqual(this._bootstrapToken, token.trim(), "utf8");
    }

    private async verifyPassword(password: string): Promise<{success: boolean, migrateToBcrypt: boolean}> {
        if(password.length == 0) {
            return {success: false, migrateToBcrypt: false};
        }
        if(this.isBcryptHash(this._key)) {
            return {success: await bcrypt.compare(password, this._key), migrateToBcrypt: false};
        }
        // P3-T4 / REQ-04: 레거시 SHA512 해시 비교를 상수시간으로 수행.
        // 이 경로는 bcrypt 마이그레이션 전용이지만, 해시 일치 여부 검증은
        // 길이-고정 hex 문자열 비교이므로 상수시간이 필요하다.
        return {success: timingSafeStringEqual(this._key, this.hashPassword(password), "utf8"), migrateToBcrypt: true};
    }

    private isBcryptHash(hash: string): boolean {
        return /^\$2[aby]\$\d{2}\$/.test(hash);
    }

    private async persistPasswordHash(passwordHash: string): Promise<boolean> {
        const keyFile = new File(Environment.path.configDir, KEY_FILE_NAME);
        try {
            await this.writeSecureFile(keyFile, passwordHash);
            this._key = passwordHash;
            logger.info(`A new password has been set.`)
            logger.info(`Write key file : ${keyFile.toString()}`);
            return true;
        } catch (e) {
            logger.error(`Can not write file : ${keyFile.toString()}`, e);
            return false;
        }
    }

    private async clearBootstrapToken(): Promise<void> {
        const tokenFile = new File(Environment.path.configDir, BOOTSTRAP_TOKEN_FILE_NAME);
        this._bootstrapToken = "";
        if(tokenFile.exists()) {
            try {
                await fsp.rm(tokenFile.toString(), {force: true});
            } catch {}
        }
    }

    private removeBootstrapTokenFile(): void {
        const tokenFile = new File(Environment.path.configDir, BOOTSTRAP_TOKEN_FILE_NAME);
        if(tokenFile.exists()) {
            tokenFile.delete();
        }
    }

    private async writeSecureFile(file: File, value: string): Promise<void> {
        const parent = file.getParentFile();
        if(!parent.isDirectory()) {
            parent.mkdirs();
        }
        await fsp.writeFile(file.toString(), value, {encoding: "utf-8", mode: 0o600});
        this.secureFile(file);
    }

    private writeSecureFileSync(file: File, value: string): void {
        const parent = file.getParentFile();
        if(!parent.isDirectory()) {
            parent.mkdirs();
        }
        fs.writeFileSync(file.toString(), value, {encoding: "utf-8", mode: 0o600});
        this.secureFile(file);
    }

    private secureFile(file: File): void {
        try {
            fs.chmodSync(file.toString(), 0o600);
        } catch {}
    }






}

export default SessionStore;
export { BOOTSTRAP_TOKEN_FILE_NAME, DEFAULT_TIMEOUT, LoginResult };

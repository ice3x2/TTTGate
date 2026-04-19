import bcrypt from 'bcryptjs';
import Environment from "../../Environment";
import File from "../../util/File"
import Files from "../../util/Files";
import CryptoJS from "crypto-js";
import {ClockRngProvider} from "../../util/ClockRng";
import crypto from "crypto";
import fs from "fs";
import fsp from "fs/promises";

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
        let now = this.now();
        this._sessions.forEach((session, key) => {
            if(session.timeout < now) {
                this._sessions.delete(key);
            }
        })
    }


    public async isSessionValid(sessionKeyList: Array<string>) : Promise<boolean> {
        let valid = false;
        sessionKeyList.forEach((sessionKey) => {
            let session = this._sessions.get(sessionKey);
            if (session) {
                let now = this.now();
                if (session.timeout > now) {
                    session.timeout = now + DEFAULT_TIMEOUT;
                    valid = true;
                } else {
                    this._sessions.delete(sessionKey);
                }
            }
        });
        return valid;
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
        return CryptoJS.SHA512(password + salt).toString();
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
        const actual = Buffer.from(this._bootstrapToken, "utf-8");
        const received = Buffer.from(token.trim(), "utf-8");
        if(actual.length != received.length) {
            return false;
        }
        return crypto.timingSafeEqual(actual, received);
    }

    private async verifyPassword(password: string): Promise<{success: boolean, migrateToBcrypt: boolean}> {
        if(password.length == 0) {
            return {success: false, migrateToBcrypt: false};
        }
        if(this.isBcryptHash(this._key)) {
            return {success: await bcrypt.compare(password, this._key), migrateToBcrypt: false};
        }
        return {success: this._key == this.hashPassword(password), migrateToBcrypt: true};
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

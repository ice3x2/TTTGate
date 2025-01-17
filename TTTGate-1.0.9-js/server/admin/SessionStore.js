"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const Environment_1 = __importDefault(require("../../Environment"));
const File_1 = __importDefault(require("../../util/File"));
const Files_1 = __importDefault(require("../../util/Files"));
const crypto_js_1 = __importDefault(require("crypto-js"));
const LoggerFactory_1 = __importDefault(require("../../util/logger/LoggerFactory"));
const logger = LoggerFactory_1.default.getLogger('server', 'SessionStore');
const DEFAULT_TIMEOUT = 1000 * 60 * 60 * 12; // 12 hours
const KEY_FILE_NAME = '.key';
class SessionStore {
    static _instance;
    _sessions = new Map();
    _key = '';
    constructor() {
        this.loadKey();
    }
    static get instance() {
        if (!SessionStore._instance) {
            SessionStore._instance = new SessionStore();
        }
        return SessionStore._instance;
    }
    loadKey() {
        let keyFile = new File_1.default(Environment_1.default.path.configDir, KEY_FILE_NAME);
        if (keyFile.exists()) {
            let key = Files_1.default.toStringSync(keyFile);
            if (key) {
                this._key = key;
            }
        }
    }
    async isEmptyKey() {
        return this._key == '';
    }
    async newSession() {
        let sessionKey = crypto_js_1.default.SHA512(Date.now().toString() + Math.random().toString()).toString();
        this._sessions.set(sessionKey, { key: sessionKey, timeout: Date.now() + DEFAULT_TIMEOUT });
        return sessionKey;
    }
    async removeSession(sessionKey) {
        this._sessions.delete(sessionKey);
    }
    sweepSession() {
        let now = Date.now();
        this._sessions.forEach((session, key) => {
            if (session.timeout < now) {
                this._sessions.delete(key);
            }
        });
    }
    async isSessionValid(sessionKeyList) {
        let valid = false;
        sessionKeyList.forEach((sessionKey) => {
            let session = this._sessions.get(sessionKey);
            if (session) {
                if (session.timeout > Date.now()) {
                    session.timeout = Date.now() + DEFAULT_TIMEOUT;
                    valid = true;
                }
                else {
                    this._sessions.delete(sessionKey);
                }
            }
        });
        return valid;
    }
    async login(key) {
        if (this._key == '' && key.length > 0) {
            this._key = this.hashPassword(key);
            let keyFile = new File_1.default(Environment_1.default.path.configDir, KEY_FILE_NAME);
            try {
                await Files_1.default.write(keyFile, this._key);
                logger.info(`A new password has been set.`);
                logger.info(`Write key file : ${keyFile.toString()}`);
            }
            catch (e) {
                logger.error(`Can not write file : ${keyFile.toString()}`, e);
                return false;
            }
        }
        return this._key == this.hashPassword(key);
    }
    // noinspection DuplicatedCode
    hashPassword(password) {
        password = password.trim() + '@';
        let salt = '';
        for (let i = 0; i < password.length; i++) {
            salt += Math.round(password.charCodeAt(i) / 2).toString(16);
        }
        return crypto_js_1.default.SHA512(password + salt).toString();
    }
}
exports.default = SessionStore;

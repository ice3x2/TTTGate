import bcrypt from 'bcryptjs';
import Environment from "../../Environment";
import File from "../../util/File"
import Files from "../../util/Files";
import CryptoJS from "crypto-js";

import LoggerFactory  from "../../util/logger/LoggerFactory";
const logger = LoggerFactory.getLogger('server', 'SessionStore');

type Session = {
    key: string;
    timeout: number;
}

const DEFAULT_TIMEOUT = 1000 * 60 * 60 * 12; // 12 hours
const KEY_FILE_NAME = '.key';
class SessionStore {
    private static _instance: SessionStore;
    private _sessions: Map<string, Session> = new Map<string, Session>();
    private _key : string = '';

    private constructor() {
        this.loadKey();
    }

    public static get instance(): SessionStore {
        if (!SessionStore._instance) {
            SessionStore._instance = new SessionStore();
        }
        return SessionStore._instance;
    }

    private  loadKey() {
         let keyFile = new File(Environment.path.configDir, KEY_FILE_NAME);
        if(keyFile.exists()) {
            let key = Files.toStringSync(keyFile);
            if(key) {
                this._key = key;
            }
        }
    }

    public async isEmptyKey() {
        return this._key == '';
    }

    public async newSession() : Promise<string>  {
        let sessionKey = CryptoJS.SHA512(Date.now().toString() + Math.random().toString()).toString();
        this._sessions.set(sessionKey, {key: sessionKey, timeout: Date.now() + DEFAULT_TIMEOUT});
        return sessionKey;
    }

    public async removeSession(sessionKey: string) : Promise<void> {
        this._sessions.delete(sessionKey);
    }

    public sweepSession() : void {
        let now = Date.now();
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
                if (session.timeout > Date.now()) {
                    session.timeout = Date.now() + DEFAULT_TIMEOUT;
                    valid = true;
                } else {
                    this._sessions.delete(sessionKey);
                }
            }
        });
        return valid;
    }


    public async login(key : string) {
        if(this._key == '' && key.length > 0) {
            this._key = this.hashPassword(key);
            let keyFile = new File(Environment.path.configDir, KEY_FILE_NAME);
            try {
                await Files.write(keyFile, this._key);
                logger.info(`A new password has been set.`)
                logger.info(`Write key file : ${keyFile.toString()}`);
            } catch (e) {
                logger.error(`Can not write file : ${keyFile.toString()}`, e);
                return false;
            }
        }

        return this._key == this.hashPassword(key);
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






}

export default SessionStore;
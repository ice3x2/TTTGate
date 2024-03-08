
//@ts-ignore
import captcha from '@bestdon/nodejs-captcha';
import crypto from 'crypto';

type CaptchaInfo = {
    token?: string,
    expire?: number
    expireTime?: number,
    value: string,
    width: number,
    height: number,
    image: string
}


const EXPIRE_TIME = 1000 * 60 * 5; // 5 minutes

class CaptchaStore {
    private captchaInfoMap: Map<string, CaptchaInfo> = new Map<string, CaptchaInfo>();

    private static _instance: CaptchaStore;

    private constructor() {
    }

    public static get instance(): CaptchaStore {
        if (!CaptchaStore._instance) {
            CaptchaStore._instance = new CaptchaStore();
        }
        return CaptchaStore._instance;
    }

    public async createCaptcha(): Promise<CaptchaInfo> {
        this.expireCheck();
        let captchaInfo :CaptchaInfo = captcha();
        captchaInfo.token = crypto.randomUUID().replace(/-/g, '');
        captchaInfo.expire = Date.now() + EXPIRE_TIME; // 5 minutes
        captchaInfo.expireTime = EXPIRE_TIME;
        this.captchaInfoMap.set(captchaInfo.token, captchaInfo);
        return captchaInfo;
    }

    public expireCheck() {
        let now = Date.now();
        this.captchaInfoMap.forEach((captchaInfo, key) => {
            if(!captchaInfo.expire || captchaInfo.expire < now) {
                this.captchaInfoMap.delete(key);
            }
        });
    }

    public releaseImage(token: string): void {
        let info = this.captchaInfoMap.get(token);
        if(info) {
            info.image = '';
        }
    }

    public verify(token: string,value: string ): boolean {
        this.expireCheck();
        let captchaInfo = this.captchaInfoMap.get(token);
        if(!captchaInfo) return false;
        let result = captchaInfo.value == value;
        this.captchaInfoMap.delete(token);
        return result;
    }


}

export { CaptchaStore, CaptchaInfo}
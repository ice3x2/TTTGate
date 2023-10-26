import  CryptoJS from "crypto-js";
class LoginCtrl {

    private constructor() {

    }

    public static async isEmptyKey() : Promise<boolean> {
        let result = await fetch("/api/emptyKey", {
            method: "GET",
            credentials: "same-origin"
        });
        let json = await result.json();
        return json['emptyKey'];
    }

    public static async validateSession() : Promise<boolean> {

        let result = await fetch("/api/validateSession", {
            method: "GET",
            credentials: "same-origin"
        });
        let json = await result.json();
        return json['valid'];
    }

    public static async login(key: string) : Promise<boolean> {
        let hash =await LoginCtrl.hashPassword(key);
        let result = await fetch("/api/login", {
            method: "POST",
            credentials: "same-origin",
            headers: {
                'Content-Type': 'application/json'
            }
            ,body: JSON.stringify({key: hash})
        })
        let json = await result.json();
        return json['success'];
    }

    private static async hashPassword(password: string) {
        password = password.trim() + '@';
        let salt : string = '';
        for(let i =0; i < password.length; i++) {
            salt += Math.round(password.charCodeAt(i) / 2).toString(16);
        }
        return CryptoJS.SHA512(password + salt).toString();
    }



}
export default LoginCtrl;
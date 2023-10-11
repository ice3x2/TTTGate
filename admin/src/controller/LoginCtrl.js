import CryptoJS from "crypto-js";
class LoginCtrl {
    constructor() {
    }
    static async isEmptyKey() {
        let result = await fetch("/api/emptyKey", {
            method: "GET",
            credentials: "same-origin"
        });
        let json = await result.json();
        return json['emptyKey'];
    }
    static async validateSession() {
        console.log("validateSession");
        let result = await fetch("/api/validateSession", {
            method: "GET",
            credentials: "same-origin"
        });
        let json = await result.json();
        return json['valid'];
    }
    static async login(key) {
        let hash = await LoginCtrl.hashPassword(key);
        let result = await fetch("/api/login", {
            method: "POST",
            credentials: "same-origin",
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ key: hash })
        });
        let json = await result.json();
        return json['success'];
    }
    static async hashPassword(password) {
        password = password.trim() + '@';
        let salt = '';
        for (let i = 0; i < password.length; i++) {
            salt += Math.round(password.charCodeAt(i) / 2).toString(16);
        }
        return CryptoJS.SHA512(password + salt).toString();
    }
}
export default LoginCtrl;
//# sourceMappingURL=LoginCtrl.js.map
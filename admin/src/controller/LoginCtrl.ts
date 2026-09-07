type LoginResult = {
    success: boolean;
    status: number;
    bootstrapRequired?: boolean;
    invalidBootstrapToken?: boolean;
    weakPassword?: boolean;
    message?: string;
};

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

    public static async login(key: string, bootstrapToken?: string) : Promise<LoginResult> {
        let result = await fetch("/api/login", {
            method: "POST",
            credentials: "same-origin",
            headers: {
                'Content-Type': 'application/json'
            }
            ,body: JSON.stringify({key, bootstrapToken})
        })
        let json = await result.json();
        return {...json, status: result.status, success: result.ok && json.success === true};
    }



}
export default LoginCtrl;



class SecurityCtrl {

    static _instance: SecurityCtrl;

    private constructor() {
        // Private constructor, singleton
    }

    public static get instance() {
        if (!this._instance) {
            this._instance = new SecurityCtrl();
        }
        return this._instance;
    }

    public async getCountries() : Promise<Array<{code: string, name: string}>> {
        let result = await fetch("/api/security/countryCodes", {
            method: "GET",
            credentials: "same-origin",
            headers: {
                'Content-Type': 'application/json'
            }
        })
        let json = await result.json();
        return json['countryNames'];
    }


}

export default SecurityCtrl;

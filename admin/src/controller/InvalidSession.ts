class InvalidSession extends Error {
    constructor() {
        super('Invalid session');
        this.name = 'InvalidSession';
    }
}

export default InvalidSession;
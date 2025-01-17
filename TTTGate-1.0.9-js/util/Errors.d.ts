declare class Errors {
    static toString(error: any): string;
    private static getCauseList;
    private static getCause;
    private static printError;
    private static printStackTrace;
}
export default Errors;

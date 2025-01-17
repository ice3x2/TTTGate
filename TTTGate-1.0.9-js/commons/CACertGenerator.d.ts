type CACert = {
    key: string;
    cert: string;
    fingerprint: string;
};
declare class CACertGenerator {
    static result: CACert | null;
    static genCACert(options?: any): Promise<CACert>;
}
export default CACertGenerator;

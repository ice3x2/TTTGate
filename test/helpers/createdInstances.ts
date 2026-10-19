/**
 * 정적 create 로 만든 인스턴스를 테스트마다 모아 afterEach 에서 정리한다.
 *
 * 정리하지 않으면 기한 타이머가 테스트 파일이 끝난 뒤에 로그를 남긴다. test:unit 은 --detectOpenHandles 로
 * 한 프로세스에서 돌므로 jest 가 "Cannot log after tests are done" 과 함께 process.exitCode 를 1 로 남기고,
 * 전부 통과해도 실패로 끝난다(#190). 파일 최상위에서 한 번 부른다.
 */
export function cleanupCreatedInstances<T>(owner: {create: (...args: any[]) => T}, cleanup: (instance: T) => void): void {
    const created: T[] = [];
    let spy: jest.SpyInstance | undefined;
    beforeEach(() => {
        const original = owner.create;
        spy = jest.spyOn(owner as any, "create").mockImplementation((...args: any[]) => {
            const instance = original.apply(owner, args);
            created.push(instance);
            return instance;
        });
    });
    afterEach(() => {
        spy?.mockRestore();
        spy = undefined;
        for(const instance of created.splice(0)) cleanup(instance);
    });
}

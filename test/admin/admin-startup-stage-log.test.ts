import {createStageLog} from '../helpers/adminBrowser';

test('stage log reports every per-stage duration and the total elapsed time', () => {
    let clock = 1_000;
    const log = createStageLog(() => clock);
    expect(log.current).toBe('fork-created');
    clock = 1_200; log.record('import-vite');
    clock = 1_500; log.record('create');
    clock = 9_000; log.record('listen');
    clock = 24_000;
    expect(log.current).toBe('listen');
    expect(log.format()).toBe('fork-created=200ms import-vite=300ms create=7500ms listen=15000ms total=23000ms');
});

test('stage log keeps the latest stage reported twice as a single span', () => {
    let clock = 0;
    const log = createStageLog(() => clock);
    clock = 100; log.record('listen');
    clock = 300; log.record('listen');
    clock = 400;
    expect(log.format()).toBe('fork-created=100ms listen=300ms total=400ms');
});

import {mount, unmount} from 'svelte';
import ServerSettingsScreen from '../src/screens/ServerSettingsScreen.svelte';
import TunnelEditScreen from '../src/screens/TunnelEditScreen.svelte';
import ServerOptionCtrl from '../src/controller/ServerOptionCtrl';
import Toast from '../src/ui/Toast.svelte';

let editor: ReturnType<typeof mount>;
let toasts: ReturnType<typeof mount> | undefined;

(window as any).configurationFixture = {
    mount: (kind: string, param?: string) => {
        // 저장 결과 문구는 토스트로 나오므로 테스트가 읽을 토스트 영역을 한 번 띄워 둔다.
        if(!toasts) toasts = mount(Toast, {target: document.body});
        editor = kind === 'server'
            ? mount(ServerSettingsScreen, {target: document.body})
            : mount(TunnelEditScreen, {target: document.body, props: {param: param ?? 'new'}});
    },
    unmount: () => unmount(editor),
    controller: ServerOptionCtrl.instance,
};

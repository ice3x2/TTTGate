import {mount, unmount} from 'svelte';
import TunnelOptionSetLayout from '../src/layout/TunnelOptionSetLayout.svelte';
import ServerSettingsScreen from '../src/screens/ServerSettingsScreen.svelte';
import ServerOptionCtrl from '../src/controller/ServerOptionCtrl';

let editor: ReturnType<typeof mount>;
(window as any).configurationFixture = {
    mount: (kind: string) => { editor = mount(kind === 'server' ? ServerSettingsScreen : TunnelOptionSetLayout, {target: document.body}); },
    unmount: () => unmount(editor),
    controller: ServerOptionCtrl.instance,
};

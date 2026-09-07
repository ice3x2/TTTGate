import {mount, unmount} from 'svelte';
import TunnelOptionSetLayout from '../src/layout/TunnelOptionSetLayout.svelte';
import ServerSetLayout from '../src/layout/ServerSetLayout.svelte';
import ServerOptionCtrl from '../src/controller/ServerOptionCtrl';

let editor: ReturnType<typeof mount>;
(window as any).configurationFixture = {
    mount: (kind: string) => { editor = mount(kind === 'server' ? ServerSetLayout : TunnelOptionSetLayout, {target: document.body}); },
    unmount: () => unmount(editor),
    controller: ServerOptionCtrl.instance,
};

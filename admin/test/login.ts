import {mount} from 'svelte';
import LoginScreen from '../src/screens/LoginScreen.svelte';
import LoginCtrl from '../src/controller/LoginCtrl';

mount(LoginScreen, {target: document.getElementById('login')!, props: {onsuccess: () => { location.href = '/'; }}});
(window as any).loginFixture = {
    login: (key: string, bootstrapToken?: string) => (LoginCtrl.login as any)(key, bootstrapToken),
};

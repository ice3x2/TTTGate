import {mount} from 'svelte';
import LoginScreen from '../src/screens/LoginScreen.svelte';
import LoginCtrl from '../src/controller/LoginCtrl';

mount(LoginScreen, {target: document.getElementById('login')!, props: {onsuccess: () => { location.href = '/'; }}});
(window as any).loginFixture = {
    login: (username: string, password: string, bootstrapToken?: string) => LoginCtrl.login(username, password, bootstrapToken),
};

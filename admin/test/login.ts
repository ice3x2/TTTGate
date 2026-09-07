import {mount} from 'svelte';
import Login from '../src/layout/Login.svelte';
import LoginCtrl from '../src/controller/LoginCtrl';

mount(Login, {target: document.getElementById('login')!});
(window as any).loginFixture = {
    login: (key: string, bootstrapToken?: string) => (LoginCtrl.login as any)(key, bootstrapToken),
};

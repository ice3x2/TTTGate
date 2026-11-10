// 이슈 349: 언어를 정하는 모듈을 가장 먼저 불러온다. 화면 모듈이 평가되기 전에 언어가 정해져야 한다.
import './i18n/start'
import './app.css'
import App from './App.svelte'
import { mount } from 'svelte'

const app = mount(App, {
  target: document.getElementById('app')!,
})

export default app

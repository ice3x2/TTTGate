import {startI18n} from './index';

// 이슈 349: main.ts 가 가장 먼저 불러온다. 화면 모듈이 평가되기 전에 언어를 정한다.
startI18n(navigator, document.documentElement);

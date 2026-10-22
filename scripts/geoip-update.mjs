#!/usr/bin/env node
// geoip-update.mjs — U5-10 / #126
//
// 목적: geoip-lite 가 동봉한 updatedb.js 를 호출해 MaxMind GeoLite2 데이터를 갱신한다.
//
// 사용:
//   MAXMIND_LICENSE_KEY=<키> node scripts/geoip-update.mjs
//
// 종료 코드:
//   0  갱신 성공
//   2  MAXMIND_LICENSE_KEY 가 비어 있어 갱신하지 않고 동봉 DB 를 그대로 둔 경우
//   그 외  updatedb.js 가 반환한 실패 코드 (신호로 종료되었으면 1)
//
// 2 를 따로 쓰는 이유: 릴리스 스크립트가 "갱신하지 않았다" 를 실제 실패(1)와 구분해야 한다.
// 라이선스 키 값은 stdout·stderr 어디에도 출력하지 않는다.

import {spawnSync} from "node:child_process";

const key = process.env.MAXMIND_LICENSE_KEY;
if(!key) {
    process.stderr.write("MAXMIND_LICENSE_KEY is not set; keeping the bundled GeoLite2 database\n");
    process.exit(2);
}

const result = spawnSync(process.execPath, ["node_modules/geoip-lite/scripts/updatedb.js", "license_key=" + key], {stdio: "inherit"});
process.exit(result.status ?? 1);

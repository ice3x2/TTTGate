// Sentinel.exec 가 실제로 띄우는 자식. 자기 정보를 저널에 남기고 SIGTERM 까지 대기한다.
const fs = require("node:fs");
fs.appendFileSync(process.env.SENTINEL_TEST_JOURNAL, JSON.stringify({pid: process.pid,
    mode: process.env.EXECUTE_MODE, appPid: process.env.APP_PID, argv: process.argv.slice(2)}) + "\n");
setInterval(() => {}, 1000);

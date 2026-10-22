import ClientApp, {resolveClientCliOptions} from "./client/ClientApp";
import ServerApp, {validateServerCliOptions} from "./server/ServerApp";
import Environment from "./Environment";
import Sentinel from "./Sentinel";
import AppCompositionRoot from "./bootstrap/AppCompositionRoot";
import CLI, {ParsedCommandLine} from "./util/CLI";
import {renderHelp, renderVersion} from "./util/CliHelp";

AppCompositionRoot.configureLogger();

/** 명령줄 오류(#204). 아무것도 시작하지 않고 종료 코드 2 로 끝낸다. */
const reportCliErrors = (parsed: ParsedCommandLine): void => {
    for(const error of parsed.errors) {
        process.stderr.write(`TTTGate: ${error}\n`);
    }
    process.stderr.write(`Run 'TTTGate${parsed.mode === "none" ? "" : " " + parsed.mode} --help' for usage.\n`);
    process.exitCode = 2;
};

/**
 * 데몬 부모가 자식을 띄우기 전에 부작용 없이 설정을 검사한다(#207 REQ-1·REQ-2).
 * 자식은 stdio 를 버리므로 여기서 걸러야 오류가 사용자에게 보인다.
 */
const validateBeforeDaemon = (parsed: ParsedCommandLine): boolean => {
    const result = parsed.mode === "client" ? resolveClientCliOptions(parsed.options)
        : parsed.mode === "server" ? validateServerCliOptions(parsed.options)
        : {ok: true as const};
    if(result.ok) return true;
    process.stderr.write(result.message + "\n");
    process.exitCode = result.exitCode;
    return false;
};

let app = () => {
    let parsedCli = CLI.parseCommandLine();
    if(parsedCli.errors.length > 0) {
        reportCliErrors(parsedCli);
        return;
    }
    const options = parsedCli.options;
    // #208: 도움말·버전은 배너 없이 출력하고, 모드 분기·Sentinel 보다 먼저 끝낸다(PID·로그 파일을 만들지 않는다).
    if(options["version"] !== undefined) {
        console.log(renderVersion());
        return;
    }
    if(options["help"] !== undefined || options["h"] !== undefined || options["help-advanced"] !== undefined) {
        console.log(renderHelp(parsedCli.mode, options["help-advanced"] !== undefined));
        return;
    }

    console.log(renderVersion());
    let startType = parsedCli.mode;
    if(startType == 'none') {
        console.log(renderHelp('none', false));
        return;
    }

    let sentinel : Sentinel = Sentinel.create(Environment.devMode);

    if(startType == 'stop') {
        console.log('Stop TTTGate processes ...')
        Sentinel.stop();
        return;
    }
    else if(Sentinel.isSentinelMode()) {
        sentinel.start();
        return;
    }
    else if(!Sentinel.hasExecuteMode() && Sentinel.isDaemonMode()) {
        if(!validateBeforeDaemon(parsedCli)) return;
        sentinel.start();
        return;
    }
    else if(startType == 'server' && !sentinel.start()) {
        AppCompositionRoot.useServerCacheDir();
        ServerApp.start(options).then(() => {
            console.log('server started');
        }).catch((err) => {
            console.error(err);
        });
    }
    else if(startType == 'client' && !sentinel.start()) {
        AppCompositionRoot.useClientCacheDir();
        ClientApp.start(options);
    }
}



app();

import { spawn } from 'child_process';
import readline from 'readline';
import Path from "path";
import http from 'http';




class Sentinel {

    private _pathList : Array<string> = [];
    private _rootPID : number = process.pid;

    private _http = undefined;
    constructor() {
        this._pathList = [Path.join(process.cwd(), 'node_modules', 'ts-node-dev', 'lib', 'bin.js'),'--project',Path.join(process.cwd(), 'tsconfig.json') , Path.join(process.cwd(), 'src', 'Sentinel.ts')]
    }

    private startSentinel() {

        const parentPID = process.env.PARENT_PID;
        if(parentPID != undefined) {
            const http = require('http');
            http.createServer((req : any, res : any) => {

            });
            http.l

            return;
        }

        const controller = new AbortController();
        const { signal } = controller;
        const child = spawn('node', this._pathList, {
            signal,
            detached: true,
            env: {
                ...process.env,
                PARENT_PID: process.pid.toString()
            },
            stdio: ['ignore', 'ignore', 'ignore']
        });
        child.unref();


        /*
        child.stdout.on('data', (data) => {

            console.log(data.toString());
        });

        child.stderr.on('data', (data) => {
            console.log(data.toString());
        });*/






        child.on('error', (err) => {
            console.log('error sentinel');
            console.error(err);
        });
        child.on('exit', (code, signal) => {
            console.log('exit sentinel');
            if(code != null) {
                console.log('sentinel exit code: ' + code);
            }
            if(signal != null) {
                console.log('sentinel exit signal: ' + signal);
            }
            controller.abort();
        });
        child.on('data', (data : any) => {
            console.log(data);
        });
        child.on('message', (message : any) => {
            console.log(message);
        });
        child.on('close', (code, signal) => {
           console.log('close sentinel');
           console.log(code);
              console.log(signal);
        });
        child.on('spawn', () => {
            console.log('spawn sentinel');
            console.log(child.pid!);
        });



        console.log('start sentinel')

        process.on('SIGINT', () => {
            console.log('SIGINT');
            controller.abort();
            process.exit(0);
        });
    }

    public start() {
        this.startSentinel();
    }

}

let rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});
rl.on('line', (input) => {

});

new Sentinel().start();



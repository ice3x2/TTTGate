"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
const Path = __importStar(require("path"));
const DEV_MODE = process.argv.find((arg) => arg == '-dev') != undefined;
const ROOT_DIR = (process.argv[0].includes('node') || process.argv[0].includes('npm')) ? process.cwd() : Path.join(process.argv[DEV_MODE ? 1 : 0], '..', '..');
const Environment = {
    path: {
        logDir: Path.join(ROOT_DIR, 'logs'),
        configDir: Path.join(ROOT_DIR, 'config'),
        //cacheDir : Path.join(ROOT_DIR, 'cache'),
        serverCacheDir: Path.join(ROOT_DIR, 'cache', 'server'),
        clientCacheDir: Path.join(ROOT_DIR, 'cache', 'client'),
        certDir: Path.join(ROOT_DIR, 'cert'),
        adminCertDir: Path.join(ROOT_DIR, 'cert', 'admin'),
        externalCertDir: Path.join(ROOT_DIR, 'cert', 'external'),
        webDir: Path.join(ROOT_DIR, 'web'),
        binDir: !DEV_MODE ? Path.join(ROOT_DIR, 'bin') : Path.join(ROOT_DIR),
    },
    devMode: DEV_MODE,
    version: {
        build: '20250117',
        name: '1.0.9'
    }
};
exports.default = Environment;

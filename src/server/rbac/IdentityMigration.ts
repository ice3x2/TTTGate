import crypto from "crypto";
import fs from "fs";
import bcrypt from "bcryptjs";
import Environment from "../../Environment";
import File from "../../util/File";
import Files from "../../util/Files";
import {timingSafeStringEqual} from "../../util/timingSafeStringEqual";
import LoggerFactory from "../../util/logger/LoggerFactory";
import {IdentityStore} from "./IdentityStore";
import {hashLegacyPassword} from "./legacyPasswordHash";
import {IDENTITY_FILE_NAME, isBcryptHash, User, validatePassword, validateUsername} from "./IdentityTypes";

const logger = LoggerFactory.getLogger('server', 'IdentityMigration');

const BOOTSTRAP_TOKEN_FILE_NAME = '.bootstrap-token';
const KEY_FILE_NAME = '.key';
const LEGACY_ADMIN_USERNAME = 'admin';

type MigrationOutcome =
    | {kind: 'loaded'} | {kind: 'migrated'} | {kind: 'bootstrap-required'} | {kind: 'legacy-fallback'; reason: string};

type BootstrapResult =
    | {success: true; user: User}
    | {success: false; bootstrapRequired: true; invalidBootstrapToken: boolean; weakPassword: boolean; invalidUsername: boolean}
    | {success: false; bootstrapRequired: false};

let startupPromise: Promise<MigrationOutcome> | undefined;
let currentOutcome: MigrationOutcome | undefined;
let bootstrapToken = '';
let bootstrapRequiredFlag = false;

function keyFile(): File {
    return new File(Environment.path.configDir, KEY_FILE_NAME);
}

function tokenFile(): File {
    return new File(Environment.path.configDir, BOOTSTRAP_TOKEN_FILE_NAME);
}

function identityYamlFile(): File {
    return new File(Environment.path.configDir, IDENTITY_FILE_NAME);
}

function removeBootstrapTokenFileIfExists(): void {
    const file = tokenFile();
    if(file.exists()) {
        file.delete();
    }
}

function secureExistingTokenFile(file: File): void {
    try {
        fs.chmodSync(file.toString(), 0o600);
    } catch {
        // 권한 변경 실패는 무시한다(SessionStore.ensureBootstrapState 의 기존 동작과 동일).
    }
}

function ensureBootstrapToken(): void {
    const file = tokenFile();
    if(file.isFile()) {
        const existing = Files.toStringSync(file)?.trim();
        if(existing && existing.length > 0) {
            bootstrapToken = existing;
            secureExistingTokenFile(file);
            return;
        }
    }
    bootstrapToken = crypto.randomBytes(32).toString('hex');
    Files.writeAtomicBatchSync([{file, data: bootstrapToken, mode: 0o600}]);
    logger.warn(`Bootstrap token created at ${file.toString()}`);
}

async function runAtStartup(): Promise<MigrationOutcome> {
    if(startupPromise) {
        return startupPromise;
    }
    startupPromise = (async (): Promise<MigrationOutcome> => {
        if(identityYamlFile().exists()) {
            const loadResult = IdentityStore.instance.load();
            if(loadResult.success) {
                removeBootstrapTokenFileIfExists();
                return {kind: 'loaded'};
            }
            IdentityStore.instance.enterLegacyFallback(loadResult.reason);
            logger.error(`identity.yaml unreadable (${loadResult.reason}); falling back to legacy admin key`);
            return {kind: 'legacy-fallback', reason: loadResult.reason};
        }

        const keyContent = keyFile().exists() ? (Files.toStringSync(keyFile())?.trim() ?? '') : '';
        if(keyContent.length > 0) {
            const createResult = await IdentityStore.instance.createUser({
                username: LEGACY_ADMIN_USERNAME,
                role: 'superuser',
                passwordHash: keyContent,
                mustChangePassword: false,
                migratedFromLegacyAdmin: true
            });
            if(createResult.success) {
                logger.info('identity migrated from legacy admin key');
                removeBootstrapTokenFileIfExists();
                return {kind: 'migrated'};
            }
            IdentityStore.instance.enterLegacyFallback('identity save failed');
            return {kind: 'legacy-fallback', reason: 'identity save failed'};
        }

        ensureBootstrapToken();
        bootstrapRequiredFlag = true;
        return {kind: 'bootstrap-required'};
    })();

    const outcome = await startupPromise;
    currentOutcome = outcome;
    return outcome;
}

function outcome(): MigrationOutcome | undefined {
    return currentOutcome;
}

function bootstrapRequired(): boolean {
    return bootstrapRequiredFlag;
}

async function completeBootstrap(input: {username: string; password: string; bootstrapToken?: string}): Promise<BootstrapResult> {
    if(!bootstrapRequiredFlag) {
        return {success: false, bootstrapRequired: false};
    }

    const passwordResult = validatePassword(input.password);
    if(!passwordResult.success) {
        return {success: false, bootstrapRequired: true, invalidBootstrapToken: false, weakPassword: true, invalidUsername: false};
    }
    const usernameResult = validateUsername(input.username);
    if(!usernameResult.success) {
        return {success: false, bootstrapRequired: true, invalidBootstrapToken: false, weakPassword: false, invalidUsername: true};
    }
    const providedToken = typeof input.bootstrapToken === 'string' ? input.bootstrapToken.trim() : undefined;
    const tokenValid = providedToken !== undefined && timingSafeStringEqual(bootstrapToken, providedToken, 'utf8');
    if(!tokenValid) {
        return {success: false, bootstrapRequired: true, invalidBootstrapToken: true, weakPassword: false, invalidUsername: false};
    }

    const createResult = await IdentityStore.instance.createUser({
        username: usernameResult.value,
        password: passwordResult.value,
        role: 'superuser',
        mustChangePassword: false,
        migratedFromLegacyAdmin: false
    });
    if(!createResult.success) {
        return {success: false, bootstrapRequired: true, invalidBootstrapToken: false, weakPassword: false, invalidUsername: false};
    }

    removeBootstrapTokenFileIfExists();
    bootstrapToken = '';
    bootstrapRequiredFlag = false;
    currentOutcome = {kind: 'loaded'};
    return {success: true, user: createResult.value};
}

async function verifyLegacyKey(password: string): Promise<boolean> {
    const file = keyFile();
    if(!file.exists()) {
        return false;
    }
    const content = Files.toStringSync(file)?.trim() ?? '';
    if(content.length === 0) {
        return false;
    }
    if(isBcryptHash(content)) {
        return bcrypt.compare(password, content);
    }
    return timingSafeStringEqual(content, hashLegacyPassword(password), 'utf8');
}

function resetForTest(): void {
    startupPromise = undefined;
    currentOutcome = undefined;
    bootstrapToken = '';
    bootstrapRequiredFlag = false;
}

const IdentityMigration = {
    runAtStartup,
    outcome,
    bootstrapRequired,
    completeBootstrap,
    verifyLegacyKey,
    hashLegacyPassword,
    resetForTest
};

export {IdentityMigration, BOOTSTRAP_TOKEN_FILE_NAME, KEY_FILE_NAME, LEGACY_ADMIN_USERNAME, MigrationOutcome, BootstrapResult};

type SimpleCliOptions = {
    [key: string]: string | undefined;
}

const normalizeBooleanOption = (value?: string): boolean | undefined => {
    if(value == undefined) {
        return undefined;
    }

    const normalized = value.trim().toLowerCase();
    if(normalized.length == 0) {
        return true;
    }
    if(["true", "1", "yes", "on"].includes(normalized)) {
        return true;
    }
    if(["false", "0", "no", "off"].includes(normalized)) {
        return false;
    }
    return true;
};

const shouldResetServerState = (options: SimpleCliOptions): boolean => {
    return normalizeBooleanOption(options["reset"]) === true;
};

/** -allowLegacyControlAuth 의 값(#218). 옵션이 없으면 undefined 로 server.yaml 값을 그대로 둔다. */
const legacyControlAuthFromCli = (options: SimpleCliOptions): boolean | undefined =>
    normalizeBooleanOption(options["allowLegacyControlAuth"]);

/** 플래그가 켜졌는지(#218). 없으면 false. 값은 normalizeBooleanOption 규칙(false·0·no·off 는 거짓)을 따른다. */
const isFlagOn = (options: SimpleCliOptions, ...names: string[]): boolean =>
    names.some((name) => normalizeBooleanOption(options[name]) === true);

export { normalizeBooleanOption, shouldResetServerState, legacyControlAuthFromCli, isFlagOn, SimpleCliOptions };

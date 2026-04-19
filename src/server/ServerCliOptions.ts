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

export { normalizeBooleanOption, shouldResetServerState, SimpleCliOptions };

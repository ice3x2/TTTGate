type RollbackMetadata = {
    at: number;
    reason: string;
    failedScopes: string[];
    attemptedRevision: number;
    restoredRevision: number;
}

type RevisionState = {
    currentRevision: number;
    lastKnownGoodRevision: number;
    lastCommittedAt: number;
    lastKnownGoodAt: number;
    pendingRestartScopes: string[];
    lastRollback?: RollbackMetadata;
}

const createInitialRevisionState = (): RevisionState => {
    const now = Date.now();
    return {
        currentRevision: 1,
        lastKnownGoodRevision: 1,
        lastCommittedAt: now,
        lastKnownGoodAt: now,
        pendingRestartScopes: []
    };
};

export { createInitialRevisionState, RevisionState, RollbackMetadata };

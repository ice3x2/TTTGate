// The actual child environment is set before Node/os/helper initialization.
const fs = require('node:fs');
const path = require('node:path');
const {createArtifactRoot} = require('../helpers/artifactRoot');
const [target, receipt] = process.argv.slice(2);
const facts = {stage: 'create'};
try {
    const artifact = createArtifactRoot('report-');
    facts.recorded = artifact.root;
    facts.canonical = fs.realpathSync(artifact.root);
    facts.createdWithinTarget = path.dirname(facts.canonical) === target;
    if(!facts.createdWithinTarget) throw new Error('Child artifact escaped its newly owned alias target');
    fs.writeFileSync(path.join(facts.canonical, 'actual-report.txt'), 'actual owned artifact');
    facts.stage = 'cleanup';
    artifact.cleanup();
    facts.stage = 'complete';
} catch(error) {
    facts.failure = String(error);
    process.exitCode = 1;
} finally {
    fs.writeFileSync(receipt, JSON.stringify(facts, null, 2));
}

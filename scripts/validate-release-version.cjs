const isValidReleaseVersion = version => typeof version === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(version);

module.exports = {isValidReleaseVersion};

if(require.main === module && !isValidReleaseVersion(process.argv[2])) {
    console.error('Invalid release version');
    process.exitCode = 1;
}

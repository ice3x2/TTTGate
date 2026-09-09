const http = require('node:http');
const mode = process.argv[2];
process.stdout.write('owned-ready-stdout');
process.stderr.write('owned-ready-stderr');
if(mode === 'early') process.exitCode = 23;
else {
    const server = http.createServer((_req, res) => res.end('owned ready'));
    server.listen(0, '127.0.0.1', () => {
        if(mode === 'no-ready') process.send({stage: 'listen'});
        if(mode === 'ready') process.send({url: `http://127.0.0.1:${server.address().port}`});
    });
    process.on('message', message => {
        if(message === 'close') server.close(() => process.disconnect());
    });
}

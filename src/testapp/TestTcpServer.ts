import net from 'net';
const client = new net.Socket();


const server = net.createServer((socket) => {

    console.log('Client connected.');

    socket.on('close', () => {
        console.log('Client closed the connection.');
    });

    socket.on('end', () => {
        console.log('Client ended the connection.');
    });

    socket.on('timeout', () => {
        console.log('Connection timed out.');
    });

    socket.on('data', (data) => {
        const receivedData = data.toString('utf-8');
        console.log('Received data on Server:', receivedData + ' (' + receivedData.length + ')');
        socket.write(receivedData);
    });

    socket.on('error', (err) => {
        console.error('Socket error:', err);
    });
});


const port = 3000;
server.listen(port, () => {
    console.log(`Server is listening on port ${port}.`);






    client.on('connect', () => {



        console.log('Connected to the server.');
        sendMessages(10, 1024);
    });

    client.on('close', () => {
        console.log('Connection closed.');
    });

    client.on('error', (err) => {
        console.error('Socket error:', err);
    });

    client.on('data', (data) => {
        let message = data.toString();
        console.log('Received data on Client :', message + ' (' + message.length + ')');
    });

    function sendMessages(times: number, count: number) {
        let sentMessages = 0;

        const sendData = () => {
            if (sentMessages >= times) {
                client.end();
                return;
            }

            const message = '1'.repeat(count) + '\n';
            if(!client.write(message, () => {
                console.log(`Sent message ${sentMessages + 1}: "${message}" (${message.length})`);
                sentMessages++;
                setTimeout(sendData, 10);
            })) {
                console.log("write failed");
            }

        };

        sendData();
    }

    const clientPort = 9010;
    client.connect(clientPort, '127.0.0.1', () => {

        client.setNoDelay(true);


        console.log(`Client is connected to 127.0.0.1:${port}`);
    });








});





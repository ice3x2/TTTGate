import net from 'net';

const client = new net.Socket();

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
    console.log('Received data:', data.toString());
});

function sendMessages(times: number, count: number) {
    let sentMessages = 0;

    const sendData = () => {
        if (sentMessages >= times) {
            //client.end();
            return;
        }

        const message = '1'.repeat(count) + '\n';
        client.write(message, () => {
            console.log(`Sent message ${sentMessages + 1}: "${message}"`);
            sentMessages++;
            setTimeout(sendData, 10);
        });
    };

    sendData();
}

const port = 9010;
client.connect(port, '127.0.0.1', () => {
    console.log(`Client is connected to 127.0.0.1:${port}`);
});
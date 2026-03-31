const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const pty = require('node-pty');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

io.on('connection', (socket) => {
    const target = socket.handshake.query.container || 'corporate_ws';
    console.log(`[DEBUG] Attempting to connect to: ${target}`);

    // We try 'bash' first, but we catch errors if the container/shell is missing
    let shell;
    try {
        shell = pty.spawn('docker', ['exec', '-it', target, 'bash'], {
            name: 'xterm-color',
            cols: 80,
            rows: 24,
            env: process.env
        });
    } catch (err) {
        console.error(`[ERROR] Failed to spawn bash for ${target}:`, err);
        socket.emit('output', '\r\n[ERROR] Could not connect to container shell.\r\n');
        return;
    }

    shell.onData((data) => socket.emit('output', data));
    socket.on('input', (data) => shell.write(data));

    // Handle process exit (e.g., if 'bash' is not found in the container)
    shell.onExit(({ exitCode, signal }) => {
        console.log(`[DEBUG] Shell for ${target} exited with code ${exitCode}`);
        if (exitCode !== 0) {
            socket.emit('output', `\r\n[SYSTEM] Connection to ${target} failed. Ensure the container is running and bash is installed.\r\n`);
        }
    });

    socket.on('disconnect', () => {
        console.log(`[DEBUG] Student disconnected from ${target}`);
        shell.kill();
    });
});

server.listen(3000, '0.0.0.0', () => {
    console.log(`Management Platform live at http://localhost:3000`);
});
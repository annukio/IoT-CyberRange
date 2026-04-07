const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const pty = require('node-pty');
const path = require('path');
const { exec } = require('child_process');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Track the current scenario in memory
// In the future this could be persisted to a file ?
let currentScenario = 's0';

app.use(express.json());

// STATIC ROUTES

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// SCENARIO MANAGEMENT
function advanceScenario(targetScenario, callback) {
    // launch.sh lives two levels up: management_platform/ -> iot-cyber-range/
    const scriptPath = path.join(__dirname, '../../launch.sh');

    exec(`${scriptPath} ${targetScenario}`, (error, stdout, stderr) => {
        if (error) {
            console.error(`[ERROR] Failed to advance to ${targetScenario}:`, stderr);
            return callback(error);
        }
        currentScenario = targetScenario;
        console.log(`[*] Advanced to ${targetScenario}`);
        callback(null);
    });
}

// GET /api/scenario — lets the frontend know which scenario is active
app.get('/api/scenario', (req, res) => {
    res.json({ scenario: currentScenario });
});

// VALIDATION ENDPOINTS (one per challenge)

// Challenge 1: Confirm Corporate WS cannot reach OT (ping to PLC must fail)
app.post('/api/validate/challenge1', (req, res) => {
    exec(
        'docker exec corporate_ws ping -c 3 -W 1 172.22.0.11',
        (error, stdout, stderr) => {
            const blocked = error !== null; // ping failing means the rule is working

            if (blocked) {
                console.log('[✓] Challenge 1 validated — OT is unreachable from Corporate WS');
                advanceScenario('s1', (advErr) => {
                    if (advErr) {
                        return res.status(500).json({
                            success: false,
                            message: 'Validation passed but failed to advance scenario.',
                        });
                    }
                    res.json({
                        success: true,
                        message: 'OT is unreachable from Corporate WS. Network segmentation confirmed.',
                        nextScenario: 's1',
                    });
                });
            } else {
                console.log('[✗] Challenge 1 failed — OT is still reachable');
                res.json({
                    success: false,
                    message: 'Corporate WS can still reach the PLC. Check your iptables rules on the firewall.',
                });
            }
        }
    );
});

// Placeholder for Challenge 2 - Legacy OS hardening
app.post('/api/validate/challenge2', (req, res) => {
    res.status(501).json({ message: 'Challenge 2 validation not yet implemented.' });
});

// Placeholder for Challenge 3 - IoT API auth
app.post('/api/validate/challenge3', (req, res) => {
    res.status(501).json({ message: 'Challenge 3 validation not yet implemented.' });
});

// TERMINAL
io.on('connection', (socket) => {
    const target = socket.handshake.query.container || 'corporate_ws';
    console.log(`[DEBUG] Attempting to connect to: ${target}`);

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

    shell.onExit(({ exitCode }) => {
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
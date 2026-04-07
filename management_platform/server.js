const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const pty = require('node-pty');
const path = require('path');
const { exec } = require('child_process');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json());

// PROGRESS PERSISTENCE

const PROGRESS_FILE = path.join(__dirname, 'progress.json');

function loadProgress() {
    try {
        return JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf8'));
    } catch {
        return {};
    }
}

function saveProgress(data) {
    fs.writeFileSync(PROGRESS_FILE, JSON.stringify(data, null, 2));
}

function deepMerge(target, source) {
    const result = { ...target };
    for (const key of Object.keys(source)) {
        if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
            result[key] = deepMerge(target[key] || {}, source[key]);
        } else {
            result[key] = source[key];
        }
    }
    return result;
}

app.get('/api/progress', (req, res) => {
    res.json(loadProgress());
});

app.post('/api/progress', (req, res) => {
    try {
        const incoming = req.body;
        const current = loadProgress();
        const merged = deepMerge(current, incoming);
        saveProgress(merged);
        res.json({ success: true, progress: merged });
    } catch (err) {
        console.error('[ERROR] Failed to save progress:', err);
        res.status(500).json({ success: false, error: 'Failed to save progress' });
    }
});

// SCENARIO MANAGEMENT

let currentScenario = 's0';

function advanceScenario(targetScenario, callback) {
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

app.get('/api/scenario', (req, res) => {
    res.json({ scenario: currentScenario });
});

// VALIDATION ENDPOINTS

app.post('/api/validate/challenge1', (req, res) => {
    exec(
        'docker exec corporate_ws ping -c 3 -W 1 172.22.0.11',
        (error, stdout, stderr) => {
            const blocked = error !== null;
            if (blocked) {
                console.log('[✓] Challenge 1 validated — OT unreachable from Corporate WS');
                advanceScenario('s1', (advErr) => {
                    if (advErr) {
                        return res.status(500).json({
                            success: false,
                            message: 'Validation passed but failed to advance scenario.',
                        });
                    }
                    res.json({
                        success: true,
                        message: 'OT is unreachable from Corp WS. Network segmentation confirmed.',
                        nextScenario: 's1',
                    });
                });
            } else {
                res.json({
                    success: false,
                    message: 'Corp WS can still reach the PLC. Check your iptables FORWARD rules on the firewall.',
                });
            }
        }
    );
});

app.post('/api/validate/challenge2', (req, res) => {
    res.status(501).json({ message: 'Challenge 2 validation not yet implemented.' });
});

app.post('/api/validate/challenge3', (req, res) => {
    res.status(501).json({ message: 'Challenge 3 validation not yet implemented.' });
});

// STATIC ROUTES

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
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
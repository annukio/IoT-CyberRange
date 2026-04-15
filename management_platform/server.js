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
// currentScenario is initialised from the SCENARIO env var set in docker-compose,
// so starting s1 containers directly gives the s1 UI without any browser action.

let currentScenario = process.env.SCENARIO || 's0';
console.log(`[*] Starting with scenario: ${currentScenario}`);

// advanceScenario applies the required changes to the running containers via
// docker exec (no full restart needed) and tells every connected browser to reload.
function advanceScenario(targetScenario, callback) {
    let cmds = [];

    if (targetScenario === 's1') {
        // Apply network-segmentation firewall rules on the existing firewall container.
        cmds = [
            'docker exec firewall iptables -P FORWARD DROP',
            'docker exec firewall iptables -A FORWARD -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT',
            'docker exec firewall iptables -A FORWARD -s 172.20.0.0/24 -d 172.21.0.10 -p tcp --dport 80 -j ACCEPT',
            'docker exec firewall iptables -A FORWARD -s 172.21.0.0/24 -d 172.22.0.0/24 -j DROP',
            'docker exec firewall iptables -A FORWARD -s 172.20.0.0/24 -d 172.22.0.0/24 -j DROP',
            'docker exec firewall iptables -A FORWARD -s 172.22.0.0/24 -d 172.20.0.0/24 -j DROP',
        ];
    } else if (targetScenario === 's2') {
        // s2 hardening is applied manually by the student; nothing to auto-apply here.
        cmds = [];
    } else {
        return callback(new Error(`Unknown target scenario: ${targetScenario}`));
    }

    const run = (remaining, done) => {
        if (remaining.length === 0) return done(null);
        exec(remaining[0], (err) => {
            if (err) {
                console.warn(`[WARN] Command failed (continuing): ${remaining[0]} — ${err.message}`);
            }
            run(remaining.slice(1), done);
        });
    };

    run(cmds, (err) => {
        if (err) return callback(err);
        currentScenario = targetScenario;
        console.log(`[*] Advanced to ${targetScenario}`);
        // Tell all browsers to reload — they will pick up the new scenario HTML.
        io.emit('scenarioChanged', { scenario: targetScenario });
        callback(null);
    });
}

app.get('/api/scenario', (req, res) => {
    res.json({ scenario: currentScenario });
});

// VALIDATION ENDPOINTS

// Challenge 1: Network Segmentation (s0 → s1)
// Verifies that the Corporate WS cannot reach the PLC.
app.post('/api/validate/challenge1', (req, res) => {
    exec(
        'docker exec corporate_ws ping -c 3 -W 1 172.22.0.11',
        (error) => {
            const blocked = error !== null;
            if (blocked) {
                console.log('[✓] Challenge 1 validated — OT unreachable from Corporate WS');
                advanceScenario('s1', (advErr) => {
                    if (advErr) {
                        return res.status(500).json({
                            success: false,
                            message: 'Validation passed but could not advance scenario. Check Docker connectivity.',
                        });
                    }
                    res.json({
                        success: true,
                        message: 'OT zone is unreachable from Corp WS. Network segmentation confirmed.',
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

// Challenge 2: Legacy OT System Protection (s1 → s2)
// Verifies that telnet (port 23) is no longer listening on the Legacy OS.
app.post('/api/validate/challenge2', (req, res) => {
    exec(
        'docker exec legacy_os ss -tlnp',
        (error, stdout) => {
            if (error) {
                return res.status(500).json({
                    success: false,
                    message: 'Could not reach the legacy_os container. Is it running?',
                });
            }
            const telnetActive = stdout.includes(':23');
            if (!telnetActive) {
                console.log('[✓] Challenge 2 validated — telnet no longer listening on legacy_os');
                // Mark scenario as s2 in memory but do not redirect
                // (index-s2.html is not yet implemented).
                currentScenario = 's2';
                res.json({
                    success: true,
                    message: 'Telnet service is disabled. Legacy OS exposure reduced. Challenge 2 complete.',
                    nextScenario: 's2',
                });
            } else {
                res.json({
                    success: false,
                    message: 'Telnet (port 23) is still listening. Run: service openbsd-inetd stop',
                });
            }
        }
    );
});

app.post('/api/validate/challenge3', (req, res) => {
    res.status(501).json({ message: 'Challenge 3 validation not yet implemented.' });
});

// STATIC ROUTES
// Serve scenario-specific HTML so the UI matches the active challenge.
app.get('/', (req, res) => {
    const htmlFile = `index-${currentScenario}.html`;
    const htmlPath = path.join(__dirname, htmlFile);
    if (fs.existsSync(htmlPath)) {
        res.sendFile(htmlPath);
    } else {
        // Fallback to s0 if the target scenario HTML has not been created yet.
        res.sendFile(path.join(__dirname, 'index-s0.html'));
    }
});

// Keep legacy /index.html accessible just in case.
app.use(express.static(__dirname));


// TERMINAL
// Control connections (container === 'control') stay open without spawning a shell;
// they are used exclusively for server-to-client events (e.g. scenarioChanged).

io.on('connection', (socket) => {
    const target = socket.handshake.query.container;

    if (!target || target === 'control') {
        // Control channel — no shell, just keep the socket alive for broadcasts.
        return;
    }

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

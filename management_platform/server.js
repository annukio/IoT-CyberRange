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
// Priority: SCENARIO env var (set in docker-compose) > saved progress.json > 's0'
// This means starting s1 containers forces s1, but otherwise the student resumes
// wherever they left off last session.

function getInitialScenario() {
    if (process.env.SCENARIO) return process.env.SCENARIO;
    const saved = loadProgress().scenario;
    return saved || 's0';
}

let currentScenario = getInitialScenario();
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
        const current = loadProgress();
        saveProgress({ ...current, scenario: targetScenario });
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
                // Mark scenario as s2, persist it, and tell all browsers to reload.
                currentScenario = 's2';
                const cur2 = loadProgress();
                saveProgress({ ...cur2, scenario: 's2' });
                io.emit('scenarioChanged', { scenario: 's2' });
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

// Challenge 3: IoT API Authentication (s2 → s3)
// Two-part test:
//   1. Unauthenticated GET /sensor/data must return 401
//   2. Authenticated GET /sensor/data with known token must return 200
app.post('/api/validate/challenge3', (req, res) => {
    // Test 1 — unauthenticated request should be rejected
    exec(
        'docker exec iot_api curl -s -o /dev/null -w "%{http_code}" http://localhost/sensor/data',
        (err1, stdout1) => {
            if (err1 && !stdout1) {
                return res.status(500).json({
                    success: false,
                    message: 'Could not reach the iot_api container. Is it running?',
                });
            }
            const unauthStatus = stdout1.trim();
            if (unauthStatus !== '401') {
                return res.json({
                    success: false,
                    message: `Unauthenticated request returned HTTP ${unauthStatus || '(no response)'}. Expected 401. Have you created /app/token.txt and restarted the API?`,
                });
            }
            // Test 2 — authenticated request with the lab token should succeed
            exec(
                'docker exec iot_api curl -s -o /dev/null -w "%{http_code}" -H "Authorization: Bearer iot-secret-2024" http://localhost/sensor/data',
                (err2, stdout2) => {
                    if (err2 && !stdout2) {
                        return res.status(500).json({
                            success: false,
                            message: 'Could not run the authenticated test. Is the iot_api container running?',
                        });
                    }
                    const authStatus = stdout2.trim();
                    if (authStatus !== '200') {
                        return res.json({
                            success: false,
                            message: `Authenticated request returned HTTP ${authStatus}. Make sure the token in /app/token.txt is exactly: iot-secret-2024`,
                        });
                    }
                    console.log('[✓] Challenge 3 validated — IoT API requires authentication');
                    currentScenario = 's3';
                    const cur3 = loadProgress();
                    saveProgress({ ...cur3, scenario: 's3' });
                    res.json({
                        success: true,
                        message: 'API authentication confirmed. Unauthenticated requests are rejected (401). Authorized requests succeed (200).',
                        nextScenario: 's3',
                    });
                }
            );
        }
    );
});

// SKIP VALIDATION
// Lets a student bypass the automated check and advance the scenario with a written reason.
app.post('/api/skip/challenge:num', (req, res) => {
    const num = parseInt(req.params.num);
    const scenarioKey  = { 1: 's0', 2: 's1', 3: 's2' }[num];
    const nextScenario = { 1: 's1', 2: 's2', 3: 's3' }[num];
    if (!scenarioKey) return res.status(400).json({ success: false, message: 'Invalid challenge number' });

    const reason = (req.body.reason || '').trim();
    if (!reason) return res.status(400).json({ success: false, message: 'A skip reason is required' });

    const current = loadProgress();
    const sData = current[scenarioKey] || {};
    sData.formData = { ...(sData.formData || {}), skipReason: reason };
    sData.validationPassed = true;
    sData.skipped = true;
    current[scenarioKey] = sData;
    current.scenario = nextScenario;
    saveProgress(current);

    currentScenario = nextScenario;
    io.emit('scenarioChanged', { scenario: nextScenario });
    console.log(`[SKIP] Challenge ${num} skipped. Reason: ${reason}`);
    res.json({ success: true, nextScenario });
});

// TEACHER REPORT
// Accessible at /report — generates a printable HTML summary of all student answers.
app.get('/report', (req, res) => {
    const progress = loadProgress();

    const esc = (s) => String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br>');
    const val = (v) => v ? `<span class="answer">${esc(v)}</span>` : `<span class="empty">(not answered)</span>`;
    const check = (d) => {
        if (d.skipped)         return '<span class="badge skip">&#9888; Skipped</span>';
        if (d.validationPassed) return '<span class="badge pass">&#10003; Pass</span>';
        return '<span class="badge fail">&#10007; Not completed</span>';
    };
    const stepCount = (s) => {
        const d = progress[s];
        if (!d) return '0 / 7';
        return `${(d.completedSteps||[]).length} / 7`;
    };

    const challengeBlock = (key, title, subtitle, fields) => {
        const d = progress[key] || {};
        const fd = d.formData || {};
        const allFields = d.skipped
            ? [...fields, ['Skip reason', fd => fd.skipReason]]
            : fields;
        const rows = allFields.map(([label, getter]) => `
            <tr${label === 'Skip reason' ? ' class="skip-row"' : ''}>
                <td class="field-label">${label}</td>
                <td>${val(getter(fd))}</td>
            </tr>`).join('');
        return `
        <section>
            <div class="challenge-header">
                <div>
                    <h2>${title}</h2>
                    <p class="subtitle">${subtitle}</p>
                </div>
                <div class="meta">
                    <div>Steps completed: <strong>${stepCount(key)}</strong></div>
                    <div>Validation: ${check(d)}</div>
                </div>
            </div>
            <table>
                <colgroup><col style="width:200px"><col></colgroup>
                ${rows}
            </table>
        </section>`;
    };

    const s0Block = challengeBlock('s0',
        'Challenge 1: Network Segmentation',
        'Isolate the OT zone from the Corporate network using iptables FORWARD rules on the firewall.',
        [
            ['Reconnaissance observations',   fd => fd.reconNotes],
            ['Threat scenario',               fd => fd.risk && fd.risk.threat],
            ['Business impact',               fd => fd.risk && fd.risk.impact],
            ['Proposed mitigation',           fd => fd.risk && fd.risk.mitigation],
            ['Change request description',    fd => fd.crDesc],
            ['Rollback plan',                 fd => fd.crRollback],
            ['Evidence (iptables output)',    fd => fd.evidence],
        ]
    );

    const s1Block = challengeBlock('s1',
        'Challenge 2: Legacy OS Hardening',
        'Disable insecure services (telnet, SMBv1) on the end-of-life Ubuntu 18.04 system.',
        [
            ['Reconnaissance observations',   fd => fd.reconNotes],
            ['Threat scenario',               fd => fd.risk && fd.risk.threat],
            ['Business impact',               fd => fd.risk && fd.risk.impact],
            ['Proposed mitigation',           fd => fd.risk && fd.risk.mitigation],
            ['Change request description',    fd => fd.crDesc],
            ['Rollback plan',                 fd => fd.crRollback],
            ['Evidence (ss -tlnp output)',    fd => fd.evidence],
        ]
    );

    const s2Block = challengeBlock('s2',
        'Challenge 3: IoT API Authentication',
        'Implement Bearer token authentication on the IoT API so unauthenticated requests return HTTP 401.',
        [
            ['Reconnaissance observations',   fd => fd.reconNotes],
            ['Asset',                         fd => fd.risk && fd.risk.asset],
            ['Vulnerability description',     fd => fd.risk && fd.risk.vuln],
            ['Business impact',               fd => fd.risk && fd.risk.impact],
            ['Proposed mitigation',           fd => fd.risk && fd.risk.mitigation],
            ['Residual risk (after fix)',      fd => fd.risk && fd.risk.residual],
            ['Change request description',    fd => fd.crDesc],
            ['Evidence (curl output)',         fd => fd.evidence],
        ]
    );

    const allDone = ['s0','s1','s2'].every(k => progress[k] && progress[k].validationPassed);
    const generated = new Date().toLocaleString('en-GB', { timeZone: 'Europe/Madrid', dateStyle: 'full', timeStyle: 'short' });

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>ICS/IoT Cyber Range - Lab Report</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Segoe UI', Arial, sans-serif; font-size: 14px; color: #1a1a2e; background: #f4f6f9; padding: 32px; }
    .page { max-width: 900px; margin: 0 auto; background: #fff; border-radius: 8px; box-shadow: 0 2px 12px rgba(0,0,0,0.08); overflow: hidden; }
    header { background: #0d0f12; color: #d4dae8; padding: 28px 36px; display: flex; justify-content: space-between; align-items: center; }
    header h1 { font-size: 20px; font-weight: 700; letter-spacing: 0.5px; }
    header h1 span { color: #00e5a0; }
    .header-meta { text-align: right; font-size: 12px; color: #a2aaba; line-height: 1.8; }
    .summary-bar { display: flex; gap: 0; border-bottom: 1px solid #e2e8f0; }
    .summary-cell { flex: 1; padding: 16px 24px; border-right: 1px solid #e2e8f0; }
    .summary-cell:last-child { border-right: none; }
    .summary-cell .label { font-size: 10px; text-transform: uppercase; letter-spacing: 1px; color: #718096; margin-bottom: 4px; }
    .summary-cell .value { font-size: 15px; font-weight: 700; color: #1a1a2e; }
    .overall { background: ${allDone ? '#f0fff8' : '#fff8f0'}; border-bottom: 2px solid ${allDone ? '#00c87d' : '#f59e0b'}; padding: 12px 36px; font-size: 13px; font-weight: 600; color: ${allDone ? '#00875a' : '#b7791f'}; }
    section { padding: 28px 36px; border-bottom: 1px solid #e2e8f0; }
    section:last-child { border-bottom: none; }
    .challenge-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 20px; gap: 16px; }
    .challenge-header h2 { font-size: 16px; font-weight: 700; color: #1a202c; margin-bottom: 4px; }
    .subtitle { font-size: 12px; color: #718096; line-height: 1.5; max-width: 500px; }
    .meta { text-align: right; font-size: 12px; color: #4a5568; line-height: 2; white-space: nowrap; }
    table { width: 100%; border-collapse: collapse; }
    tr { border-top: 1px solid #edf2f7; }
    tr:first-child { border-top: none; }
    td { padding: 10px 12px; vertical-align: top; }
    .field-label { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; color: #718096; white-space: nowrap; padding-top: 12px; }
    .answer { display: block; font-size: 13px; color: #2d3748; line-height: 1.6; white-space: pre-wrap; font-family: inherit; }
    .empty { display: block; font-size: 12px; color: #a0aec0; font-style: italic; }
    .badge { display: inline-block; padding: 2px 10px; border-radius: 3px; font-size: 11px; font-weight: 700; letter-spacing: 0.5px; }
    .badge.pass { background: #c6f6d5; color: #22543d; }
    .badge.fail { background: #fed7d7; color: #742a2a; }
    .badge.skip { background: #fefcbf; color: #744210; }
    tr.skip-row td { background: #fffff0; }
    tr.skip-row .field-label { color: #b7791f; }
    footer { background: #f7fafc; padding: 16px 36px; font-size: 11px; color: #a0aec0; text-align: center; }
    .download-bar { display: flex; justify-content: flex-end; padding: 12px 36px; background: #f7fafc; border-bottom: 1px solid #e2e8f0; }
    .btn-pdf { display: inline-flex; align-items: center; gap: 8px; padding: 9px 18px; background: #0d0f12; color: #00e5a0; border: 1px solid #00e5a0; border-radius: 4px; font-size: 13px; font-weight: 700; letter-spacing: 0.5px; cursor: pointer; text-transform: uppercase; }
    .btn-pdf:hover { background: #00e5a0; color: #0d0f12; }
    @media print {
      body { background: white; padding: 0; }
      .page { box-shadow: none; border-radius: 0; max-width: 100%; }
      .download-bar { display: none; }
      header { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      .badge, .overall, .summary-bar { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      section { page-break-inside: avoid; }
      tr { page-break-inside: avoid; }
    }
  </style>
</head>
<body>
<div class="page">
  <div class="download-bar">
    <button class="btn-pdf" onclick="window.print()" title="Save as PDF using your browser's print dialog">&#8659; Download as PDF</button>
  </div>
  <header>
    <h1>ICS/IoT Cyber Range - <span>Lab Report</span></h1>
    <div class="header-meta">
      <div>Generated: ${generated}</div>
      <div>Scenario reached: ${(progress.scenario || 's0').toUpperCase()}</div>
    </div>
  </header>
  <div class="summary-bar">
    <div class="summary-cell"><div class="label">Challenge 1</div><div class="value">${check(progress.s0||{})}</div></div>
    <div class="summary-cell"><div class="label">Challenge 2</div><div class="value">${check(progress.s1||{})}</div></div>
    <div class="summary-cell"><div class="label">Challenge 3</div><div class="value">${check(progress.s2||{})}</div></div>
    <div class="summary-cell"><div class="label">Lab status</div><div class="value">${allDone ? '<span style="color:#00875a">Complete</span>' : '<span style="color:#b7791f">In progress</span>'}</div></div>
  </div>
  <div class="overall">${allDone ? '&#10003; All three challenges completed and validated.' : '&#9888; Lab is not yet fully complete. Some challenges are still in progress.'}</div>
  ${s0Block}
  ${s1Block}
  ${s2Block}
  <footer>ICS/IoT Cyber Range &nbsp;&bull;&nbsp; Printed ${generated}</footer>
</div>
</body>
</html>`;

    res.setHeader('Content-Type', 'text/html');
    res.send(html);
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

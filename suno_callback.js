/**
 * Suno Callback Server (Express)
 * --------------------------------
 * Receives POST callbacks from SunoAPI (e.g., /api/v1/mp4/generate callbacks),
 * stores them to a local JSON file, and exposes a tiny dashboard + REST endpoints.
 *
 * Setup:
 *   npm init -y
 *   npm i express dotenv cors
 *   node suno_callback_server.js
 *
 * Env (.env):
 *   PORT=8080
 *   AUTH_TOKEN=change-this-token
 *
 * Suno callback URL to configure on your requests:
 *   https://<your-domain>/suno/callback?token=change-this-token
 *
 * Notes:
 * - Optional simple token auth via query (?token=...) or header (Authorization: Bearer TOKEN)
 * - Data persisted to ./callbacks-db.json
 * - Minimal HTML dashboard at GET / (lists latest callbacks)
 */

const fs = require('fs');
const path = require('path');
const express = require('express');
const cors = require('cors');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 8080;
const AUTH_TOKEN = process.env.AUTH_TOKEN || '';

const DB_FILE = path.join(__dirname, 'callbacks-db.json');

// Ensure DB file exists
function initDb() {
  if (!fs.existsSync(DB_FILE)) {
    fs.writeFileSync(DB_FILE, JSON.stringify({ callbacks: [] }, null, 2));
  }
}
initDb();

function readDb() {
  try {
    const raw = fs.readFileSync(DB_FILE, 'utf-8');
    return JSON.parse(raw);
  } catch (e) {
    return { callbacks: [] };
  }
}

function writeDb(data) {
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}

// Middlewares
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Very simple auth (optional)
function checkAuth(req, res, next) {
  if (!AUTH_TOKEN) return next(); // no auth required
  const q = req.query?.token;
  const h = (req.headers['authorization'] || '').replace(/Bearer\s+/i, '').trim();
  if (q && q === AUTH_TOKEN) return next();
  if (h && h === AUTH_TOKEN) return next();
  return res.status(401).json({ code: 401, msg: 'Unauthorized: invalid or missing token' });
}

// Receive callback
app.post('/suno/callback', checkAuth, (req, res) => {
  const payload = req.body || {};
  const now = new Date().toISOString();

  // Build record
  const record = {
    id: `${Date.now()}_${Math.random().toString(16).slice(2)}`,
    receivedAt: now,
    ip: req.headers['x-forwarded-for'] || req.socket.remoteAddress || null,
    userAgent: req.headers['user-agent'] || null,
    payload
  };

  // Persist
  const db = readDb();
  db.callbacks.unshift(record);
  // keep only latest 500 records
  db.callbacks = db.callbacks.slice(0, 500);
  writeDb(db);

  // If Suno expects 200 quickly, respond first
  res.json({ code: 200, msg: 'ok' });

  // Log helpful info to console
  try {
    const status =
      payload?.data?.status ||
      payload?.data?.response?.status ||
      payload?.msg ||
      'unknown';

    const videoTaskId =
      payload?.data?.taskId ||
      payload?.taskId ||
      payload?.data?.videoTaskId ||
      null;

    const downloadUrl =
      payload?.data?.downloadUrl ||
      payload?.data?.mp4Url ||
      payload?.data?.url ||
      payload?.data?.fileUrl ||
      payload?.data?.videoUrl ||
      payload?.data?.response?.downloadUrl ||
      null;

    console.log(`[${now}] Callback received: status=${status} taskId=${videoTaskId} url=${downloadUrl || '-'} `);
  } catch (e) {}
});

// List callbacks (JSON)
app.get('/callbacks', checkAuth, (req, res) => {
  const db = readDb();
  res.json({ code: 200, msg: 'ok', data: db.callbacks });
});

// Get one by id
app.get('/callbacks/:id', checkAuth, (req, res) => {
  const db = readDb();
  const found = db.callbacks.find((c) => c.id === req.params.id);
  if (!found) return res.status(404).json({ code: 404, msg: 'not found' });
  res.json({ code: 200, msg: 'ok', data: found });
});

// Simple dashboard (HTML)
app.get('/', (req, res) => {
  const db = readDb();
  const rows = db.callbacks.slice(0, 50).map((c) => {
    // Try to extract useful fields for the table
    const status =
      c.payload?.data?.status ||
      c.payload?.data?.response?.status ||
      c.payload?.msg || 'unknown';

    const taskId =
      c.payload?.data?.taskId ||
      c.payload?.taskId ||
      c.payload?.data?.videoTaskId ||
      '—';

    const downloadUrl =
      c.payload?.data?.downloadUrl ||
      c.payload?.data?.mp4Url ||
      c.payload?.data?.url ||
      c.payload?.data?.fileUrl ||
      c.payload?.data?.videoUrl ||
      c.payload?.data?.response?.downloadUrl ||
      '';

    return `<tr>
      <td style="font-family:monospace">${c.id}</td>
      <td>${c.receivedAt}</td>
      <td>${status}</td>
      <td style="font-family:monospace">${taskId}</td>
      <td>${downloadUrl ? `<a href="${downloadUrl}" target="_blank">download</a>` : '—'}</td>
    </tr>`;
  }).join('\n');

  res.send(`
<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Suno Callback Dashboard</title>
  <style>
    body { font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial; margin: 24px; }
    table { border-collapse: collapse; width: 100%; }
    th, td { border: 1px solid #e5e7eb; padding: 8px 10px; text-align: left; }
    th { background: #f3f4f6; }
    tr:nth-child(even) { background: #fafafa; }
    code { background: #f3f4f6; padding: 2px 4px; border-radius: 4px; }
  </style>
</head>
<body>
  <h1>🔔 Suno Callback Dashboard</h1>
  <p>Latest callbacks (max 50). Protect the endpoint with <code>AUTH_TOKEN</code> in your <code>.env</code>, e.g. use <code>?token=YOUR_TOKEN</code>.</p>

  <h3>Endpoints</h3>
  <ul>
    <li><code>POST /suno/callback?token=YOUR_TOKEN</code></li>
    <li><code>GET /callbacks?token=YOUR_TOKEN</code></li>
    <li><code>GET /callbacks/:id?token=YOUR_TOKEN</code></li>
  </ul>

  <h3>Recent</h3>
  <table>
    <thead>
      <tr>
        <th>ID</th>
        <th>Received</th>
        <th>Status</th>
        <th>TaskID</th>
        <th>Video</th>
      </tr>
    </thead>
    <tbody>
      ${rows || '<tr><td colspan="5">No data</td></tr>'}
    </tbody>
  </table>
</body>
</html>
  `);
});

app.listen(PORT, () => {
  console.log(`✅ Suno callback server running on http://localhost:${PORT}`);
  if (AUTH_TOKEN) {
    console.log(`🔒 Token protection enabled. Append ?token=${AUTH_TOKEN} to your requests.`);
  } else {
    console.log("⚠️ AUTH_TOKEN not set. Endpoint is public — set AUTH_TOKEN in .env to protect it.");
  }
});

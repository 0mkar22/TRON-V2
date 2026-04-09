require('dotenv').config();
const express = require('express');
const Redis = require('ioredis');
const verifyGitHub = require('./middleware/verifyGitHub'); 
const loadConfig = require('./config/yamlLoader');
const PMOrchestrator = require('./adapters/pm-orchestrator');

const app = express();
const port = process.env.PORT || 3000;

// 🛡️ The configuration is stored in globalConfig
const globalConfig = loadConfig();
console.log(`📊 Loaded routing rules for ${globalConfig.projects.length} project(s).`);

const redis = new Redis(process.env.REDIS_URL);
redis.on('connect', () => console.log('📦 Connected to Redis Queue'));
redis.on('error', (err) => console.error('Redis Connection Error:', err));

app.use(express.json({
    verify: (req, res, buf) => { req.rawBody = buf; }
}));

// ==========================================
// DAEMON API: START TASK
// ==========================================
app.post('/api/start-task', async (req, res) => {
    // 🛡️ 1. Security & Payload Validation
    const apiKey = req.headers['x-api-key'];
    if (apiKey !== process.env.DAEMON_API_KEY) {
        return res.status(401).send({ error: 'Unauthorized' });
    }

    const { taskInput, repoName, repoId } = req.body;
    if (!taskInput || !repoName) {
        return res.status(400).send({ error: 'Missing payload data' });
    }

    console.log(`\n🔥 Local Daemon requested task resolution for: [${taskInput}] in [${repoName}]`);

    // 🧠 2. Dynamic Config Loading
    const tronConfig = loadConfig();
    const projectConfig = tronConfig?.projects?.find(p => p.repo === repoName);

    if (!projectConfig) {
        return res.status(404).send({ error: 'Repository not configured in tron.yaml' });
    }

    try {
        let resolvedTaskID = taskInput.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase(); // Fallback sanitized string

        // 🔀 3. Route task creation through the Orchestrator
        if (projectConfig.pm_tool && projectConfig.pm_tool.provider !== "none") {
            resolvedTaskID = await PMOrchestrator.createTicket(projectConfig.pm_tool, taskInput);
        }

        // 📦 4. Send Job to the Worker Queue
        const queueJob = {
            deliveryId: `local-${Date.now()}`,
            eventType: 'local_start',
            payload: {
                taskId: resolvedTaskID,
                repository: { full_name: repoName }
            }
        };
        await redis.lpush('tron:webhook_queue', JSON.stringify(queueJob));

        // 📤 5. Respond back to the Go Daemon
        res.status(200).send({ resolvedId: resolvedTaskID });

    } catch (error) {
        console.error('❌ Failed to resolve task via Orchestrator:', error.message);
        
        // Graceful fallback so the Go Daemon can still create a branch
        const fallbackId = taskInput.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase();
        res.status(500).send({ resolvedId: fallbackId });
    }
});

// ==========================================
// GITHUB WEBHOOK ENDPOINT
// ==========================================
app.post('/webhook', /* verifyGitHub, */ async (req, res) => {
    res.status(200).send('Webhook received');

    const eventType = req.headers['x-github-event'];
    const deliveryId = req.headers['x-github-delivery'];
    const payload = req.body;

    const isNewDelivery = await redis.setnx(`delivery:${deliveryId}`, 'processed');
    if (isNewDelivery === 0) return; 

    await redis.expire(`delivery:${deliveryId}`, 172800);

    if (eventType === 'pull_request') {
        const action = payload.action;
        if (!['opened', 'closed', 'reopened'].includes(action)) return;
    }

    console.log(`\n📥 Received Valid GitHub Event: [${eventType}] | Delivery ID: [${deliveryId}]`);

    const queueJob = { deliveryId, eventType, payload };
    await redis.lpush('tron:webhook_queue', JSON.stringify(queueJob));
});

// ==========================================
// DAEMON API: PROJECT LIST
// ==========================================
app.get('/api/projects', (req, res) => {
    const apiKey = req.headers['x-api-key'];
    if (apiKey !== process.env.DAEMON_API_KEY) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    const projectNames = globalConfig.projects.map(p => p.repo);
    res.status(200).json({ projects: projectNames });
});

// ==========================================
// 🔍 NEW: FETCH TICKETS FOR GO DAEMON
// ==========================================
app.get(['/api/project/:owner/:repo/tickets', '/api/project/:encodedRepo/tickets'], async (req, res) => {
    const repo = req.params.encodedRepo 
        ? decodeURIComponent(req.params.encodedRepo) 
        : `${req.params.owner}/${req.params.repo}`;

    console.log(`\n📡 [API] Fetching tickets requested for repo: "${repo}"`);

    // 🛡️ THE FIX: Load the config directly so it never crashes on 'undefined'
    const tronConfig = loadConfig();
    
    if (!tronConfig || !tronConfig.projects) {
        console.error("❌ [API] tron.yaml is missing or malformed!");
        return res.status(500).json({ error: "Server configuration missing." });
    }

    const config = tronConfig.projects.find(p => p.repo === repo);
    
    if (!config) {
        console.warn(`⚠️ [API] Repo "${repo}" not found in tron.yaml!`);
        return res.status(404).json({ error: "Repository not registered in tron.yaml" });
    }

    try {
        const tasks = await PMOrchestrator.getTickets(config.pm_tool);
        res.json({ tickets: tasks }); 
        console.log(`✅ [API] Sent ${tasks.length} tickets to the Daemon.`);
    } catch (error) {
        console.error("❌ [API] Failed to fetch tickets:", error.message);
        res.status(500).json({ error: "Failed to fetch active tasks." });
    }
});

app.listen(port, () => {
    console.log(`\n🌐 T.R.O.N. Cloud Router listening at http://localhost:${port}`);
});

// 🛡️ THE FREE TIER HACK: Run the worker in the same process!
console.log('🚀 Booting up the integrated Background Worker...');
require('./worker');
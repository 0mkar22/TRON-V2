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
    const { taskInput, repoName } = req.body;
    const config = loadConfig().projects.find(p => p.repo === repoName);

    let resolvedTaskID = taskInput.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase(); // Default fallback

    try {
        // 1. Hand off to Orchestrator (Index.js doesn't know HOW it resolves the task)
        if (config && config.pm_tool && config.pm_tool.provider !== "none") {
            resolvedTaskID = await PMOrchestrator.resolveTask(config.pm_tool, taskInput, config.mapping);
        }

        // 2. Fire the Background Worker Event
        await redis.lpush('tron:webhook_queue', JSON.stringify({
            eventType: 'local_start',
            payload: { taskId: resolvedTaskID, repository: { full_name: repoName } }
        }));

        // 3. Honor the Go Daemon's exact expected JSON contract
        res.json({ resolvedId: resolvedTaskID });

    } catch (error) {
        res.status(500).json({ error: "Task resolution failed." });
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
app.get('/api/project/:encodedRepo/tickets', async (req, res) => {
    const repo = decodeURIComponent(req.params.encodedRepo);
    const config = loadConfig().projects.find(p => p.repo === repo);
    
    // 1. Validate
    if (!config || config.pm_tool.provider === "none") return res.json({ tickets: [] });

    try {
        // 2. Hand off to Orchestrator (Index.js doesn't know HOW it gets the tickets)
        const activeTickets = await PMOrchestrator.getTickets(config.pm_tool, config.mapping);
        
        // 3. Honor the Go Daemon's exact expected JSON contract
        res.json({ tickets: activeTickets }); 
    } catch (error) {
        res.status(500).json({ error: "Failed to fetch tickets." });
    }
});

app.listen(port, () => {
    console.log(`\n🌐 T.R.O.N. Cloud Router listening at http://localhost:${port}`);
});

// 🛡️ THE FREE TIER HACK: Run the worker in the same process!
console.log('🚀 Booting up the integrated Background Worker...');
require('./worker');
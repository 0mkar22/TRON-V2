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
    const apiKey = req.headers['x-api-key'];
    if (apiKey !== process.env.DAEMON_API_KEY) {
        return res.status(401).send({ error: 'Unauthorized' });
    }

    const { taskInput, repoName } = req.body;
    if (!taskInput || !repoName) {
        return res.status(400).send({ error: 'Missing payload data' });
    }

    console.log(`\n🔥 Local Daemon requested task resolution for: [${taskInput}] in [${repoName}]`);

    const projectConfig = globalConfig.projects.find(p => p.repo === repoName);
    if (!projectConfig) {
        return res.status(404).send({ error: 'Repository not configured in tron.yaml' });
    }

    try {
        let resolvedTaskID = `fallback-task-${Date.now()}`; 

        if (projectConfig.pm_tool && projectConfig.pm_tool !== "none") {
            const pmAdapter = require(`./adapters/${projectConfig.pm_tool}`);
            const boardID = projectConfig.board_id;
            const todoColumnID = projectConfig.mapping.todo_column;

            resolvedTaskID = await pmAdapter.resolveTask(taskInput, boardID, todoColumnID);
        }

        const queueJob = {
            deliveryId: `local-${Date.now()}`,
            eventType: 'local_start',
            payload: {
                taskId: resolvedTaskID,
                repository: { full_name: repoName }
            }
        };
        await redis.lpush('tron:webhook_queue', JSON.stringify(queueJob));

        res.status(200).send({ resolvedId: resolvedTaskID });

    } catch (error) {
        console.error('❌ Failed to resolve task:', error);
        res.status(500).send({ error: 'Failed to resolve task' });
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
// 🛡️ Handles both URL-encoded (%2F) and standard slashes from the Go Daemon
app.get(['/api/project/:owner/:repo/tickets', '/api/project/:encodedRepo/tickets'], async (req, res) => {
    // Reconstruct the repo name (e.g., "0mkar22/git-playground")
    const repo = req.params.encodedRepo 
        ? decodeURIComponent(req.params.encodedRepo) 
        : `${req.params.owner}/${req.params.repo}`;

    console.log(`\n📡 [API] Fetching tickets requested for repo: "${repo}"`);

    // Find the repo in tron.yaml
    const config = global.routingConfig.projects.find(p => p.repo === repo);
    
    if (!config) {
        console.warn(`⚠️ [API] Repo "${repo}" not found in tron.yaml!`);
        return res.status(404).json({ error: "Repository not registered in tron.yaml" });
    }

    try {
        // Fetch tickets from the Orchestrator
        const tasks = await PMOrchestrator.getTickets(config.pm_tool);
        
        // 🛡️ IMPORTANT: Wrap the array in a "tickets" object so the Go Daemon can parse it!
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
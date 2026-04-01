require('dotenv').config();
const express = require('express');
const Redis = require('ioredis');
const verifyGitHub = require('./middleware/verifyGitHub');
const loadConfig = require('./config/yamlLoader');

const app = express();
const port = process.env.PORT || 3000;

const globalConfig = loadConfig();
console.log(`📊 Loaded routing rules for ${globalConfig.projects.length} project(s).`);

const redis = new Redis(process.env.REDIS_URL);
redis.on('connect', () => console.log('📦 Connected to Redis Queue'));
redis.on('error', (err) => console.error('Redis Connection Error:', err));

app.use(express.json({
    verify: (req, res, buf) => { req.rawBody = buf; }
}));

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
        const pmAdapter = require(`./adapters/${projectConfig.pm_tool}`);
        const boardID = projectConfig.board_id;
        const todoColumnID = projectConfig.mapping.todo_column;

        // Wait for the adapter to search/create the ticket!
        const resolvedTaskID = await pmAdapter.resolveTask(taskInput, boardID, todoColumnID);

        // Queue the background job to move the card to "In Progress"
        const queueJob = {
            deliveryId: `local-${Date.now()}`,
            eventType: 'local_start',
            payload: {
                taskId: resolvedTaskID,
                repository: { full_name: repoName }
            }
        };
        await redis.lpush('tron:webhook_queue', JSON.stringify(queueJob));

        // Return the resolved mathematical ID back to the Go Daemon!
        res.status(200).send({ resolvedId: resolvedTaskID });

    } catch (error) {
        console.error('❌ Failed to resolve task:', error);
        res.status(500).send({ error: 'Failed to resolve task via PM API' });
    }
});

app.post('/webhook', verifyGitHub, async (req, res) => {
    res.status(200).send('Webhook received');

    const eventType = req.headers['x-github-event'];
    const deliveryId = req.headers['x-github-delivery'];
    const payload = req.body;

    const isNewDelivery = await redis.setnx(`delivery:${deliveryId}`, 'processed');
    if (isNewDelivery === 0) {
        console.warn(`♻️  Ignored duplicate delivery: [${deliveryId}]`);
        return; 
    }
    await redis.expire(`delivery:${deliveryId}`, 172800);

    if (eventType === 'pull_request') {
        const action = payload.action;
        if (!['opened', 'closed', 'reopened'].includes(action)) {
            console.log(`🗑️  Ignored non-actionable PR event: [${action}]`);
            return;
        }
    }

    console.log(`\n📥 Received Valid GitHub Event: [${eventType}] | Delivery ID: [${deliveryId}]`);

    const queueJob = { deliveryId, eventType, payload };

    try {
        await redis.lpush('tron:webhook_queue', JSON.stringify(queueJob));
        console.log(`🚀 Job [${deliveryId}] pushed to Redis queue successfully.`);
    } catch (error) {
        console.error('❌ Failed to push to Redis queue:', error);
    }
});

app.get('/api/projects', (req, res) => {
    // 🛡️ SECURITY FIX: Lock down the project list
    const apiKey = req.headers['x-api-key'];
    if (apiKey !== process.env.DAEMON_API_KEY) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    try {
        const config = loadConfig();
        const projectNames = config.projects.map(p => p.repo);
        res.status(200).json({ projects: projectNames });
    } catch (error) {
        res.status(500).json({ error: "Failed to load projects" });
    }
});

app.listen(port, () => {
    console.log(`\n🌐 T.R.O.N. Cloud Router listening at http://localhost:${port}`);
});
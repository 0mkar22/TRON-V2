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
        console.warn('🚨 Unauthorized attempt to access Daemon API');
        return res.status(401).send({ error: 'Unauthorized' });
    }

    res.status(200).send({ status: 'queued' });

    const { taskId, repoName } = req.body;
    if (!taskId || !repoName) {
        console.error('❌ API Error: Missing taskId or repoName in payload');
        return;
    }

    console.log(`\n🔥 Local Daemon triggered task start: [${taskId}] for [${repoName}]`);

    const queueJob = {
        deliveryId: `local-${Date.now()}`,
        eventType: 'local_start',
        payload: {
            taskId: taskId,
            repository: { full_name: repoName }
        }
    };

    try {
        await redis.lpush('tron:webhook_queue', JSON.stringify(queueJob));
    } catch (error) {
        console.error('❌ Failed to push local start event to Redis:', error);
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

app.listen(port, () => {
    console.log(`\n🌐 T.R.O.N. Cloud Router listening at http://localhost:${port}`);
});
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const Redis = require('ioredis');
const verifyGitHub = require('./middleware/verifyGitHub'); 
const loadConfig = require('./config/yamlLoader');
const PMOrchestrator = require('./adapters/pm-orchestrator');
const path = require('path');
const adminRoutes = require('./routes/admin');

const app = express();
// 🌟 NEW: Add these two lines to allow the React dashboard to connect
app.use(cors());
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


// 🌟 NEW: Mount the Admin API
app.use('/api/admin', adminRoutes);

// 🌟 NEW: Serve the compiled React Dashboard 
// (We will build this into a 'dist' folder in the next step)
app.use('/dashboard', express.static(path.join(__dirname, '../dashboard/dist')));

// Optional: Redirect /dashboard to the React index.html so client-side routing works
app.get(/^\/dashboard/, (req, res) => {
    res.sendFile(path.join(__dirname, '../dashboard/dist/index.html'));
});

// ==========================================
// DAEMON API: CREATE TASK
// ==========================================
// 🌟 NEW: "Silent" route to just create a ticket without starting a branch
app.post('/api/create-task', async (req, res) => {
    const { taskInput, repoName } = req.body;
    const config = loadConfig().projects.find(p => p.repo === repoName);

    if (!config || !config.pm_tool || config.pm_tool.provider === "none") {
         return res.status(400).json({ error: "No PM tool configured." });
    }

    try {
        // Just call the Orchestrator to create the task. 
        // We DO NOT push to the Redis webhook_queue here, so no branch/movement happens!
        const newTaskId = await PMOrchestrator.resolveTask(config.pm_tool, taskInput, config.mapping);
        res.json({ resolvedId: newTaskId });
    } catch (error) {
        console.error("Task creation failed:", error);
        res.status(500).json({ error: "Task creation failed." });
    }
});

// ==========================================
// DAEMON API: START TASK
// ==========================================
app.post('/api/start-task', async (req, res) => {
    const { taskInput, repoName } = req.body;
    const config = loadConfig().projects.find(p => p.repo === repoName);

    let resolvedTaskID = taskInput.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase(); // Default fallback

    try {
        if (config && config.pm_tool && config.pm_tool.provider !== "none") {
            // 1. Verify or Create the task
            resolvedTaskID = await PMOrchestrator.resolveTask(config.pm_tool, taskInput, config.mapping);
            
            // 🌟 THE BULLETPROOF FIX: Ignore case-sensitivity and check multiple YAML keys
            const providerName = (config.pm_tool.provider || '').toLowerCase();
            // 🌟 Tell the backend to look for 'branch_created' in your YAML!
            const inProgressId = config.mapping.branch_created || config.mapping.in_progress;

            console.log(`🔍 [DEBUG] Provider detected: '${providerName}' | In Progress ID: '${inProgressId}'`);

            if (providerName === 'basecamp') {
                if (inProgressId) {
                    const BasecampAdapter = require('./adapters/basecamp');
                    console.log(`🚚 [API] Moving task [${resolvedTaskID}] to In Progress column [${inProgressId}]...`);
                    
                    // 🌟 Accept either board_id OR project_id!
                    const projectId = config.pm_tool.board_id || config.pm_tool.project_id;

                    await BasecampAdapter.updateTicketStatus(
                        resolvedTaskID, 
                        inProgressId, 
                        projectId
                    );
                } else {
                    console.log(`❌ [API] Skipped Move: Could not find 'in_progress' inside your tron.yaml mapping!`);
                }
            }
        }

        // 2. Fire the Background Worker Event
        await redis.lpush('tron:webhook_queue', JSON.stringify({
            eventType: 'local_start',
            payload: { taskId: resolvedTaskID, repository: { full_name: repoName } }
        }));

        // 3. Respond back to VS Code
        res.json({ resolvedId: resolvedTaskID });

    } catch (error) {
        console.error("❌ API Start Task Error:", error);
        res.status(500).json({ error: "Task resolution and movement failed." });
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

// ==========================================
// 🌟 NEW: FETCH AI REVIEW FOR VS CODE
// ==========================================
app.get('/api/review/:taskId', async (req, res) => {
    try {
        const { taskId } = req.params;
        const review = await redis.get(`ai_review:${taskId}`);
        
        if (!review) {
            return res.status(404).json({ error: "No AI review found for this task yet." });
        }
        
        res.json({ review });
    } catch (error) {
        console.error("❌ Failed to fetch AI review:", error);
        res.status(500).json({ error: "Internal server error" });
    }
});

app.listen(port, () => {
    console.log(`\n🌐 T.R.O.N. Cloud Router listening at http://localhost:${port}`);
});

// 🛡️ THE FREE TIER HACK: Run the worker in the same process!
console.log('🚀 Booting up the integrated Background Worker...');
require('./worker');
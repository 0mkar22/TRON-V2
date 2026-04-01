require('dotenv').config();
const Redis = require('ioredis');
const loadConfig = require('./config/yamlLoader');
const basecampAdapter = require('./adapters/basecamp');
const githubAdapter = require('./adapters/github'); // AI PIPELINE ADAPTER
const aiAdapter = require('./adapters/ai');

const redis = new Redis(process.env.REDIS_URL);
const config = loadConfig();

// 🛡️ ARCHITECTURE FIX: Sleep helper for Exponential Backoff
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

console.log('👷 T.R.O.N. Background Worker Booting Up...');

async function startWorker() {
    console.log('🎧 Worker is actively listening to the Redis Queue...');

    while (true) {
        let currentJobString = null;
        try {
            // 🛡️ ARCHITECTURE FIX: Reliable Queue (Move to Processing List)
            const jobString = await redis.brpoplpush('tron:webhook_queue', 'tron:webhook_processing', 0);
            currentJobString = jobString; 
            const job = JSON.parse(jobString);

            console.log(`\n⚙️  Processing Delivery ID: [${job.deliveryId}]`);

            const repoName = job.payload.repository?.full_name;
            if (!repoName) {
                console.log('⏭️  Skipping: Payload does not contain a repository name.');
                continue;
            }

            const projectConfig = config.projects.find(p => p.repo === repoName);
            if (!projectConfig) {
                console.log(`⏭️  Skipping: No configuration found in tron.yaml for repo "${repoName}"`);
                continue;
            }

            // ==========================================
            // EVENT: PULL REQUEST
            // ==========================================
            if (job.eventType === 'pull_request') {
                const prTitle = job.payload.pull_request.title;
                const action = job.payload.action; 
                
                const taskMatch = prTitle.match(/\[?(TASK-\d+)\]?/i);
                if (!taskMatch) {
                    console.log(`⏭️  Skipping: No Task ID found in PR title: "${prTitle}"`);
                    continue;
                }
                const taskID = taskMatch[1].toUpperCase();

                const pmTool = projectConfig.pm_tool;
                const boardID = projectConfig.board_id;
                const mappingKey = `pull_request_${action}`;
                const newStatus = projectConfig.mapping[mappingKey];

                if (!newStatus) {
                    console.log(`⏭️  Skipping: No YAML mapping found for action "${mappingKey}"`);
                    continue;
                }

                // --- PHASE 1: PM STATE TRACKING ---
                try {
                    if (pmTool === 'basecamp') {
                        await basecampAdapter.updateTicketStatus(taskID, newStatus, boardID);
                    } else {
                        console.log(`❌ Error: Unknown PM Tool "${pmTool}"`);
                    }
                } catch (adapterError) {
                    console.error(`🚨 PM API Failed for ${taskID}.`);
                    job.retryCount = (job.retryCount || 0) + 1;
                    
                    if (job.retryCount <= 3) {
                        // 🛡️ ARCHITECTURE FIX: Exponential Backoff (2s, 4s, 8s)
                        const backoffTime = Math.pow(2, job.retryCount) * 1000;
                        console.log(`⏳ API Overloaded. Applying backoff. Waiting ${backoffTime}ms...`);
                        await sleep(backoffTime);
                        
                        await redis.lpush('tron:webhook_queue', JSON.stringify(job));
                        await redis.lrem('tron:webhook_processing', 1, currentJobString);
                    } else {
                        console.error(`💀 Job permanently failed. Moving to Dead Letter Queue.`);
                        await redis.lpush('tron:dead_letters', currentJobString);
                        await redis.lrem('tron:webhook_processing', 1, currentJobString);
                    }
                    continue; 
                }

                // --- PHASE 2: AI PIPELINE (DIFF SANITIZER & SUMMARIZATION) ---
                if (action === 'opened') {
                    // 🛡️ QoL FIX: Ignore Draft PRs so we don't waste AI credits on unfinished code!
                    if (job.payload.pull_request.draft === true) {
                        console.log(`⏭️  [AI PIPELINE] Skipping Draft PR: "${prTitle}"`);
                        return; // Exit the loop safely
                    }

                    const diffUrl = job.payload.pull_request.diff_url;
                    
                    console.log(`\n🧠 [AI PIPELINE] PR Opened: "${prTitle}"`);
                    
                    try {
                        // 1. Fetch and Clean the code diff
                        const sanitizedDiff = await githubAdapter.fetchAndSanitizeDiff(diffUrl);
                        
                        // 2. Generate the Executive Summary
                        const intelligenceReport = await aiAdapter.generateExecutiveSummary(prTitle, sanitizedDiff);
                        
                        // 3. Log the final output (Next step: Broadcast this to Slack/Teams!)
                        console.log(`\n📊 --- FINAL EXECUTIVE REPORT ---`);
                        console.log(`🏷️  Category: ${intelligenceReport.intent}`);
                        console.log(`📝 Summary:  ${intelligenceReport.executive_summary}`);
                        console.log(`🚀 Impact:   ${intelligenceReport.business_impact}`);
                        
                        // 🛡️ ARCHITECTURE FIX: The Hallucination Safety Net
                        if (intelligenceReport.confidence_score < 80) {
                            console.log(`⚠️  WARNING: AI Confidence is LOW (${intelligenceReport.confidence_score}/100). Requires Human Review!`);
                        } else {
                            console.log(`🎯 Confidence: ${intelligenceReport.confidence_score}/100`);
                        }
                        console.log(`--------------------------------\n`);

                    } catch (aiError) {
                        console.error(`❌ [AI PIPELINE] Pipeline failed:`, aiError.message);
                    }
                }

            // ==========================================
            // EVENT: LOCAL DAEMON TASK START
            // ==========================================
            } else if (job.eventType === 'local_start') {
                const taskID = job.payload.taskId;
                const pmTool = projectConfig.pm_tool;
                const boardID = projectConfig.board_id;
                
                const newStatus = projectConfig.mapping['branch_created']; 

                if (!newStatus) {
                    console.log(`⏭️  Skipping: No 'branch_created' mapping found in tron.yaml`);
                    continue;
                }

                try {
                    if (pmTool === 'basecamp') {
                        await basecampAdapter.updateTicketStatus(taskID, newStatus, boardID);
                    }
                } catch (adapterError) {
                    console.error(`🚨 PM API Failed for ${taskID}.`);
                    job.retryCount = (job.retryCount || 0) + 1;
                    
                    if (job.retryCount <= 3) {
                        // 🛡️ ARCHITECTURE FIX: Exponential Backoff (2s, 4s, 8s)
                        const backoffTime = Math.pow(2, job.retryCount) * 1000;
                        console.log(`⏳ API Overloaded. Applying backoff. Waiting ${backoffTime}ms...`);
                        await sleep(backoffTime);
                        
                        await redis.lpush('tron:webhook_queue', JSON.stringify(job));
                        await redis.lrem('tron:webhook_processing', 1, currentJobString);
                    } else {
                        console.error(`💀 Job permanently failed. Moving to Dead Letter Queue.`);
                        await redis.lpush('tron:dead_letters', currentJobString);
                        await redis.lrem('tron:webhook_processing', 1, currentJobString);
                    }
                    continue; 
                }
            }

        // 🛡️ ARCHITECTURE FIX: Job successfully finished! Remove it from processing.
            await redis.lrem('tron:webhook_processing', 1, currentJobString);

        } catch (error) {
            console.error('❌ Critical Worker Error:', error);
        }
    }
}

startWorker();

// 🛡️ QoL UPDATE: Graceful Shutdown
process.on('SIGTERM', async () => {
    console.log('\n🛑 SIGTERM received. Shutting down worker gracefully...');
    // Stop accepting new jobs from Redis
    await redis.quit();
    console.log('💤 Disconnected from Redis. Exiting process.');
    process.exit(0);
});

process.on('SIGINT', async () => {
    console.log('\n🛑 SIGINT received. Shutting down worker gracefully...');
    await redis.quit();
    console.log('💤 Disconnected from Redis. Exiting process.');
    process.exit(0);
});
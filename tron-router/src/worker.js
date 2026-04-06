require('dotenv').config();
const Redis = require('ioredis');
const loadConfig = require('./config/yamlLoader');
const basecampAdapter = require('./adapters/basecamp');
const githubAdapter = require('./adapters/github'); // AI PIPELINE ADAPTER
const aiAdapter = require('./adapters/ai');
const messengerAdapter = require('./adapters/messenger');

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
                const branchName = job.payload.pull_request.head.ref || "";
                const action = job.payload.action; 
                
                console.log(`\n🔀 [PR EVENT] Action: ${action} | Title: "${prTitle}"`);

                // 🧠 SMART ID EXTRACTION: Check branch name first, then PR title
                let taskIdentifier = null;
                const branchMatch = branchName.match(/(\d{9,})/);
                const titleMatch = prTitle.match(/(\d{9,})/);

                if (branchMatch) {
                    taskIdentifier = branchMatch[1];
                    console.log(`🎯 Extracted Task ID [${taskIdentifier}] from PR branch name.`);
                } else if (titleMatch) {
                    taskIdentifier = titleMatch[1];
                    console.log(`🎯 Extracted Task ID [${taskIdentifier}] from PR title.`);
                } else {
                    console.log(`⚠️ No numeric Task ID found in PR title or branch name.`);
                }

                // --- PHASE 1: PM STATE TRACKING ---
                const pmTool = projectConfig.pm_tool;
                const boardID = projectConfig.board_id;
                const mappingKey = `pull_request_${action}`; // e.g., 'pull_request_opened' or 'pull_request_closed'
                const newStatus = projectConfig.mapping[mappingKey];

                if (!newStatus) {
                    console.log(`⏭️  Skipping PM update: No mapping found in tron.yaml for "${mappingKey}"`);
                } else if (taskIdentifier && pmTool && pmTool !== "none") {
                    try {
                        const pmAdapter = require(`./adapters/${pmTool}`);
                        console.log(`🚚 Moving ticket [${taskIdentifier}] to ${mappingKey} in ${pmTool}...`);
                        
                        await pmAdapter.updateTicketStatus(taskIdentifier, newStatus, boardID);
                        
                        console.log(`✅ Successfully moved ticket for PR ${action}!`);
                    } catch (error) {
                        console.error(`⚠️ Failed to move PM ticket:`, error.message);
                    }
                }

                // --- PHASE 2: AI PIPELINE (DIFF SANITIZER & SUMMARIZATION) ---
                if (action === 'opened') {
                    if (job.payload.pull_request.draft === true) {
                        console.log(`⏭️  [AI PIPELINE] Skipping Draft PR: "${prTitle}"`);
                        continue; 
                    }

                    const diffUrl = job.payload.pull_request.diff_url;
                    // We need these to post the comment back to GitHub!
                    const repoFullName = job.payload.repository.full_name; 
                    const prNumber = job.payload.pull_request.number;

                    console.log(`\n🧠 [AI PIPELINE] Generating Intel & Code Review for: "${prTitle}"`);
                    
                    try {
                        // 1. Fetch and Clean the code diff
                        const sanitizedDiff = await githubAdapter.fetchAndSanitizeDiff(diffUrl);
                        
                        // 🕵️‍♂️ 2. NEW: Generate the Code Review and Post to GitHub!
                        console.log(`🕵️‍♂️ Analyzing diff for bugs...`);
                        const codeReview = await aiAdapter.generateCodeReview(sanitizedDiff);
                        
                        console.log(`💬 Posting Code Review to GitHub PR #${prNumber}...`);
                        const commentHeader = `### 🤖 T.R.O.N. Automated Code Review\n\n`;
                        await githubAdapter.postPullRequestComment(repoFullName, prNumber, commentHeader + codeReview);

                        // 3. Generate the Executive Summary for Management
                        const intelligenceReport = await aiAdapter.generateExecutiveSummary(prTitle, sanitizedDiff);
                        
                        console.log(`\n📊 --- FINAL EXECUTIVE REPORT ---`);
                        console.log(`🏷️  Category: ${intelligenceReport.intent}`);
                        console.log(`📝 Summary:  ${intelligenceReport.executive_summary}`);
                        console.log(`🚀 Impact:   ${intelligenceReport.business_impact}`);
                        console.log(`--------------------------------\n`);

                        // 4. Broadcast the Summary to Discord (Later: Slack/Teams)
                        const teamWebhookUrl = projectConfig.notification_webhook;
                        const prUrl = job.payload.pull_request.html_url;

                        // Ensure we are passing the intelligenceReport we just generated!
                        await messengerAdapter.broadcastSummary(teamWebhookUrl, prTitle, prUrl, intelligenceReport);

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
                        // await basecampAdapter.updateTicketStatus(taskID, newStatus, boardID);
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

            // ==========================================
            // EVENT: GITHUB PUSH / BRANCH CREATED (PHASE 2)
            // ==========================================
            } else if (job.eventType === 'push' || job.eventType === 'create') {
                const ref = job.payload.ref || "";
                
                // 🛡️ THE FIX: If the branch was deleted, STOP immediately.
                // Do not move the ticket back to In Progress.
                if (job.payload.deleted === true) {
                    console.log(`🗑️  [BRANCH EVENT] Branch deleted. Ignoring to prevent ticket rewind.`);
                    await redis.lrem('tron:webhook_processing', 1, currentJobString);
                    continue; 
                }

                // Ignore pushes that aren't to actual branches (like tags)
                if (job.eventType === 'push' && !ref.startsWith('refs/heads/')) {
                    console.log(`⏭️  Skipping non-branch push: ${ref}`);
                } else {
                    const branchName = ref.replace('refs/heads/', '');
                    console.log(`\n🌿 [BRANCH EVENT] Detected branch: "${branchName}"`);

                    // 🧠 THE MAGIC: Extract a 9+ digit Basecamp ID from the branch name
                    const taskIdMatch = branchName.match(/(\d{9,})/); 

                    if (taskIdMatch) {
                        const taskIdentifier = taskIdMatch[1];
                        console.log(`🎯 Extracted Task ID [${taskIdentifier}] from branch name.`);

                        const pmTool = projectConfig.pm_tool;
                        const boardID = projectConfig.board_id;
                        const newStatus = projectConfig.mapping['branch_created']; 

                        if (!newStatus) {
                            console.log(`⏭️  Skipping: No 'branch_created' mapping found in tron.yaml`);
                        } else if (pmTool && pmTool !== "none") {
                            try {
                                const pmAdapter = require(`./adapters/${pmTool}`);
                                console.log(`🚚 Moving ticket [${taskIdentifier}] to In Progress in ${pmTool}...`);
                                
                                await pmAdapter.updateTicketStatus(taskIdentifier, newStatus, boardID);
                                
                                console.log(`✅ Successfully moved ticket!`);
                            } catch (error) {
                                console.error(`⚠️ Failed to move PM ticket:`, error.message);
                            }
                        }
                    } else {
                        console.log(`⚠️  No numeric Task ID found in branch name "${branchName}". Cannot move PM card.`);
                    }
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
require('dotenv').config();
const Redis = require('ioredis');
const loadConfig = require('./config/yamlLoader');
const basecampAdapter = require('./adapters/basecamp');

const redis = new Redis(process.env.REDIS_URL);
const config = loadConfig();

console.log('👷 T.R.O.N. Background Worker Booting Up...');

async function startWorker() {
    console.log('🎧 Worker is actively listening to the Redis Queue...');

    while (true) {
        let currentJobString = null;
        try {
            const [queueName, jobString] = await redis.brpop('tron:webhook_queue', 0);
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

                try {
                    if (pmTool === 'basecamp') {
                        await basecampAdapter.updateTicketStatus(taskID, newStatus, boardID);
                    } else {
                        console.log(`❌ Error: Unknown PM Tool "${pmTool}"`);
                    }
                } catch (adapterError) {
                    console.error(`🚨 PM API Failed for ${taskID}. Pushing job back to queue!`);
                    await redis.lpush('tron:webhook_queue', currentJobString);
                }

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
                    console.error(`🚨 PM API Failed for ${taskID}. Pushing job back to queue!`);
                    await redis.lpush('tron:webhook_queue', currentJobString);
                }
            }

        } catch (error) {
            console.error('❌ Critical Worker Error:', error);
        }
    }
}

startWorker();
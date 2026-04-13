// tron-router/scripts/enterprise-sync.js
require('dotenv').config();
const readline = require('readline');
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

// Import all Adapters
const GithubAdapter = require('./adapters/sync/github');
const BasecampAdapter = require('./adapters/sync/basecamp');
const JiraAdapter = require('../src/adapters/jira'); 
const MondayAdapter = require('../src/adapters/monday'); 
const DiscordAdapter = require('./adapters/sync/discord');
const SlackAdapter = require('./adapters/sync/slack');

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

const askQuestion = (query) => new Promise(resolve => rl.question(query, resolve));

// Path to your .env file
const ENV_PATH = path.join(__dirname, '../.env');

// Helper function to securely update .env and the current running process
function updateEnvVariable(key, value) {
    let envContent = '';
    if (fs.existsSync(ENV_PATH)) {
        envContent = fs.readFileSync(ENV_PATH, 'utf8');
    }

    const regex = new RegExp(`^${key}=.*`, 'm');
    if (regex.test(envContent)) {
        // Replace existing key
        envContent = envContent.replace(regex, `${key}=${value}`);
    } else {
        // Append new key
        envContent += `\n${key}=${value}`;
    }

    fs.writeFileSync(ENV_PATH, envContent.trim() + '\n');
    process.env[key] = value; // Inject into current runtime memory
}

async function runAdminWizard() {
    console.log(`\n========================================`);
    console.log(`🧙‍♂️ T.R.O.N. Enterprise Setup Wizard`);
    console.log(`========================================\n`);

    const runSetup = await askQuestion('Do you need to configure or update provider API credentials? (y/n): ');
    
    if (runSetup.toLowerCase() === 'y') {
        // 1. BASECAMP SETUP
        const setupBasecamp = await askQuestion('Configure Basecamp? (y/n): ');
        if (setupBasecamp.toLowerCase() === 'y') {
            const bcAccount = await askQuestion('Enter Basecamp Account ID: ');
            const bcToken = await askQuestion('Enter Basecamp Access Token: ');
            updateEnvVariable('BASECAMP_ACCOUNT_ID', bcAccount);
            updateEnvVariable('BASECAMP_ACCESS_TOKEN', bcToken);
            console.log(`✅ Basecamp credentials saved.\n`);
        }

        // 2. JIRA SETUP
        const setupJira = await askQuestion('Configure Jira? (y/n): ');
        if (setupJira.toLowerCase() === 'y') {
            const jiraDomain = await askQuestion('Enter Jira Domain (e.g., your-domain.atlassian.net): ');
            const jiraEmail = await askQuestion('Enter Jira Email: ');
            const jiraToken = await askQuestion('Enter Jira API Token: ');
            updateEnvVariable('JIRA_DOMAIN', jiraDomain);
            updateEnvVariable('JIRA_EMAIL', jiraEmail);
            updateEnvVariable('JIRA_API_TOKEN', jiraToken);
            console.log(`✅ Jira credentials saved.\n`);
        }

        // 3. MONDAY SETUP
        const setupMonday = await askQuestion('Configure Monday.com? (y/n): ');
        if (setupMonday.toLowerCase() === 'y') {
            const mondayToken = await askQuestion('Enter Monday API Token: ');
            updateEnvVariable('MONDAY_API_TOKEN', mondayToken);
            console.log(`✅ Monday.com credentials saved.\n`);
        }

        // 4. GITHUB SETUP
        const setupGithub = await askQuestion('Configure GitHub? (y/n): ');
        if (setupGithub.toLowerCase() === 'y') {
            const ghToken = await askQuestion('Enter GitHub Personal Access Token: ');
            const ghWebhookSecret = await askQuestion('Enter a new Webhook Secret (or press enter to auto-generate): ');
            updateEnvVariable('GITHUB_TOKEN', ghToken);
            updateEnvVariable('GITHUB_WEBHOOK_SECRET', ghWebhookSecret || `tron_secret_${Date.now()}`);
            console.log(`✅ GitHub credentials saved.\n`);
        }
    }

    console.log(`\n🎉 Credential check complete! Moving to board synchronization...\n`);
    await runSync();
}

async function runSync() {
    console.log("🚀 Starting the T.R.O.N. Routing Configurator\n");

    // ==========================================
    // 1. FETCH GITHUB REPOS
    // ==========================================
    if (!process.env.GITHUB_TOKEN) {
        console.error("❌ GITHUB_TOKEN is missing. Please run the setup wizard.");
        process.exit(1);
    }
    const repos = await GithubAdapter.fetchRepos(process.env.GITHUB_TOKEN);
    if (repos.length === 0) {
        console.error("❌ No GitHub repositories found or token invalid.");
        process.exit(1);
    }

    // ==========================================
    // 2. FETCH PROJECT MANAGEMENT BOARDS (Multi-Provider)
    // ==========================================
    console.log("\n📡 Scanning for Project Management Integrations...");
    const availablePmBoards = [];

    if (process.env.BASECAMP_ACCESS_TOKEN && process.env.BASECAMP_ACCOUNT_ID) {
        console.log("  ✅ Basecamp detected. Fetching projects...");
        const bcProjects = await BasecampAdapter.fetchBoards(
            process.env.BASECAMP_ACCOUNT_ID, 
            process.env.BASECAMP_ACCESS_TOKEN, 
            "admin@tron.local"
        );
        availablePmBoards.push(...bcProjects.map(p => ({ provider: 'basecamp', id: p.id, name: `[Basecamp] ${p.name}` })));
    }

    if (process.env.JIRA_API_TOKEN && process.env.JIRA_DOMAIN && process.env.JIRA_EMAIL) {
        console.log("  ✅ Jira detected.");
        console.log("  ⚠️ Jira Projects currently require manual Project Key entry in yaml.");
    }

    if (process.env.MONDAY_API_TOKEN) {
         console.log("  ✅ Monday.com detected.");
         console.log("  ⚠️ Monday Boards currently require manual Board ID entry in yaml.");
    }

    // ==========================================
    // 3. FETCH COMMUNICATION CHANNELS (Multi-Provider)
    // ==========================================
    console.log("\n📡 Scanning for Communication Integrations...");
    const availableChannels = [];

    if (process.env.DISCORD_BOT_TOKEN) {
        console.log("  ✅ Discord detected. Fetching channels...");
        const dChannels = await DiscordAdapter.fetchChannels(process.env.DISCORD_BOT_TOKEN);
        availableChannels.push(...dChannels.map(c => ({ provider: 'discord', id: c.id, name: `[Discord] ${c.name}` })));
    }

    if (process.env.SLACK_BOT_TOKEN) {
        console.log("  ✅ Slack detected. Fetching channels...");
        const sChannels = await SlackAdapter.fetchChannels(process.env.SLACK_BOT_TOKEN);
        availableChannels.push(...sChannels.map(c => ({ provider: 'slack', id: c.id, name: `[Slack] ${c.name}` })));
    }

    // ==========================================
    // 4. INTERACTIVE MAPPING LOOP
    // ==========================================
    const finalConfig = { projects: [] };

    for (const repo of repos) {
        console.log(`\n------------------------------------------------`);
        const mapIt = await askQuestion(`Configure routing for repository: ${repo.full_name}? (y/n): `);
        
        if (mapIt.toLowerCase() !== 'y') continue;

        const projectBlock = {
            repo: repo.full_name,
            pm_tool: { provider: 'none' },
            mapping: {
                todo_column: 'To Do',
                branch_created: 'In Progress',
                pull_request_opened: 'Under Review',
                pull_request_closed: 'Done'
            },
            communication: { provider: 'none' }
        };

        // --- Select PM Tool ---
        console.log(`\nSelect a PM Tool for ${repo.full_name}:`);
        console.log(`0. None (Skip PM tracking)`);
        availablePmBoards.forEach((board, index) => {
            console.log(`${index + 1}. ${board.name}`);
        });

        const pmChoice = await askQuestion(`Choose PM option (0-${availablePmBoards.length}): `);
        
        let selectedColumns = [];

        const pmIndex = parseInt(pmChoice) - 1;
        if (pmIndex >= 0 && pmIndex < availablePmBoards.length) {
            const selectedBoard = availablePmBoards[pmIndex];
            projectBlock.pm_tool = { provider: selectedBoard.provider, board_id: selectedBoard.id.toString() };
            
            // DYNAMIC COLUMN MAPPING FOR BASECAMP
            if (selectedBoard.provider === 'basecamp') {
                console.log(`\nFetching columns for ${selectedBoard.name}...`);
                selectedColumns = await BasecampAdapter.fetchColumns(
                    process.env.BASECAMP_ACCOUNT_ID,
                    selectedBoard.id,
                    process.env.BASECAMP_ACCESS_TOKEN,
                    "admin@tron.local"
                );

                if (selectedColumns.length > 0) {
                    console.log(`\n📋 Found Columns:`);
                    selectedColumns.forEach((col, idx) => console.log(`${idx + 1}. ${col.name} (ID: ${col.id})`));
                    
                    const todoIdx = await askQuestion(`\nWhich column is for "To Do" (Enter number): `);
                    projectBlock.mapping.todo_column = selectedColumns[parseInt(todoIdx) - 1].id;

                    const branchIdx = await askQuestion(`Which column is for "In Progress" (Branch Created): `);
                    projectBlock.mapping.branch_created = selectedColumns[parseInt(branchIdx) - 1].id;

                    const prOpenIdx = await askQuestion(`Which column is for "Under Review" (PR Opened): `);
                    projectBlock.mapping.pull_request_opened = selectedColumns[parseInt(prOpenIdx) - 1].id;

                    const prCloseIdx = await askQuestion(`Which column is for "Done" (PR Closed): `);
                    projectBlock.mapping.pull_request_closed = selectedColumns[parseInt(prCloseIdx) - 1].id;
                } else {
                    console.log(`⚠️ Could not fetch columns. You will need to map IDs manually in tron.yaml.`);
                }
            }
        }

        // --- Select Communication Channel ---
        console.log(`\nSelect a Notification Channel for ${repo.full_name}:`);
        console.log(`0. None (Skip notifications)`);
        availableChannels.forEach((channel, index) => {
            console.log(`${index + 1}. ${channel.name}`);
        });
        console.log(`Z. Enter a manual Webhook URL (e.g., MS Teams or custom Slack webhook)`);

        const commChoice = await askQuestion(`Choose Communication option (0-${availableChannels.length}, Z): `);

        if (commChoice.toUpperCase() === 'Z') {
            const wUrl = await askQuestion("Enter Full Webhook URL: ");
            projectBlock.communication = { provider: 'teams', webhook_url: wUrl };
        } else {
            const commIndex = parseInt(commChoice) - 1;
            if (commIndex >= 0 && commIndex < availableChannels.length) {
                const selectedChannel = availableChannels[commIndex];
                projectBlock.communication = { provider: selectedChannel.provider, webhook_url: selectedChannel.id.toString() };
            }
        }

        finalConfig.projects.push(projectBlock);
        console.log(`✅ Configured ${repo.full_name}!`);
    }

    // ==========================================
    // 5. SAVE YAML
    // ==========================================
    if (finalConfig.projects.length > 0) {
        const yamlStr = yaml.dump(finalConfig, { noRefs: true });
        const outputPath = path.join(__dirname, '..', 'tron.yaml');
        fs.writeFileSync(outputPath, yamlStr, 'utf8');
        console.log(`\n🎉 Success! Wrote configuration for ${finalConfig.projects.length} projects to ${outputPath}`);
    } else {
        console.log(`\n⚠️ No projects configured. Exiting.`);
    }

    rl.close();
}

// Start the application
runAdminWizard();
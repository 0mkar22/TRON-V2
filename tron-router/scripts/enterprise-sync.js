// tron-router/scripts/enterprise-sync.js
require('dotenv').config();
const readline = require('readline');
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

// Import all Adapters
const GithubAdapter = require('./adapters/sync/github');
const BasecampAdapter = require('./adapters/sync/basecamp');
// Note: We are using the main adapter folder for Jira/Monday since they don't have separate sync scripts yet
const JiraAdapter = require('../src/adapters/jira'); 
const MondayAdapter = require('../src/adapters/monday'); 

const DiscordAdapter = require('./adapters/sync/discord');
const SlackAdapter = require('./adapters/sync/slack');
// const TeamsAdapter = require('./adapters/sync/teams'); // Teams usually requires manual webhook URLs

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

const askQuestion = (query) => new Promise(resolve => rl.question(query, resolve));

async function runSync() {
    console.log("🚀 Welcome to the T.R.O.N. Enterprise Configurator\n");

    // ==========================================
    // 1. FETCH GITHUB REPOS
    // ==========================================
    if (!process.env.GITHUB_TOKEN) {
        console.error("❌ GITHUB_TOKEN is missing from .env");
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
            "admin@tron.local" // Basecamp requires a User-Agent email
        );

        // Map to a standard format for the menu
        availablePmBoards.push(...bcProjects.map(p => ({ provider: 'basecamp', id: p.id, name: `[Basecamp] ${p.name}` })));
    }

    if (process.env.JIRA_API_TOKEN && process.env.JIRA_DOMAIN && process.env.JIRA_EMAIL) {
        console.log("  ✅ Jira detected. Fetching projects...");
        console.log("  ⚠️ Jira Projects currently require manual Project Key entry during mapping.");
    }

    if (process.env.MONDAY_API_TOKEN) {
         console.log("  ✅ Monday.com detected.");
         console.log("  ⚠️ Monday Boards currently require manual Board ID entry during mapping.");
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
        console.log(`X. Enter Jira Project Key manually`);
        console.log(`Y. Enter Monday Board ID manually`);

        const pmChoice = await askQuestion(`Choose PM option (0-${availablePmBoards.length}, X, Y): `);
        
        if (pmChoice.toUpperCase() === 'X') {
            const jKey = await askQuestion("Enter Jira Project Key (e.g., ENG): ");
            projectBlock.pm_tool = { provider: 'jira', project_key: jKey };
        } else if (pmChoice.toUpperCase() === 'Y') {
            const mId = await askQuestion("Enter Monday Board ID (e.g., 12345678): ");
            projectBlock.pm_tool = { provider: 'monday', board_id: mId };
        } else {
            const pmIndex = parseInt(pmChoice) - 1;
            if (pmIndex >= 0 && pmIndex < availablePmBoards.length) {
                const selectedBoard = availablePmBoards[pmIndex];
                projectBlock.pm_tool = { provider: selectedBoard.provider, board_id: selectedBoard.id.toString() };

                // 🧠 THE MAGIC: Auto-fetch and map Basecamp Column IDs!
                if (selectedBoard.provider === 'basecamp') {
                    console.log(`  🔄 Fetching columns for Basecamp Project: ${selectedBoard.name}...`);
                    const columns = await BasecampAdapter.fetchColumns(
                        process.env.BASECAMP_ACCOUNT_ID, 
                        process.env.BASECAMP_ACCESS_TOKEN, 
                        selectedBoard.id
                    );

                    if (columns.length > 0) {
                        const usedIds = new Set(); // 🛡️ THE UNIQUENESS ENFORCER

                        const getColId = (keywords) => {
                            // 1. Look for a keyword match that HAS NOT been used yet
                            let found = columns.find(c => {
                                if (usedIds.has(c.id)) return false;
                                
                                const colName = c.name.toLowerCase();
                                // Basic prevention of "complete" matching "incomplete"
                                return keywords.some(k => colName.includes(k) && !colName.includes('in' + k));
                            });

                            // 2. Fallback: If no keyword matches, grab the first UNUSED column
                            if (!found) {
                                found = columns.find(c => !usedIds.has(c.id)) || columns[0];
                            }

                            // 3. Lock the ID so it can't be used again
                            usedIds.add(found.id);
                            return found.id;
                        };

                        projectBlock.mapping = {
                            todo_column: getColId(['todo', 'to do', 'to-do', 'backlog']),
                            branch_created: getColId(['in progress', 'doing', 'active']),
                            pull_request_opened: getColId(['in review','under review', 'pr', 'testing']),
                            pull_request_closed: getColId(['done', 'complete', 'merged', 'finish'])
                        };
                        console.log(`  ✅ Automatically mapped UNIQUE Column IDs for Basecamp!`);
                    } else {
                        console.log(`  ⚠️ No columns found on this board. Defaulting to placeholders.`);
                    }
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
            // We assume 'teams' here as a placeholder, but the Orchestrator handles raw URLs well
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

runSync();
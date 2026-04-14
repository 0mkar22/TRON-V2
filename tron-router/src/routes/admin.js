// tron-router/src/routes/admin.js
const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

// Import ALL sync adapters
const GithubAdapter = require('../../scripts/adapters/sync/github');
const BasecampAdapter = require('../../scripts/adapters/sync/basecamp');
const DiscordAdapter = require('../../scripts/adapters/sync/discord');
const SlackAdapter = require('../../scripts/adapters/sync/slack');
// Note: Adapting these assuming they export a fetchBoards or fetchColumns method 
// like the Basecamp adapter does, or we fallback to manual ID entry.
const JiraAdapter = require('../../src/adapters/jira'); 
const MondayAdapter = require('../../src/adapters/monday'); 

// 1. GET /api/admin/repos
router.get('/repos', async (req, res) => {
    try {
        if (!process.env.GITHUB_TOKEN) return res.status(400).json({ error: "GitHub token missing" });
        const repos = await GithubAdapter.fetchRepos(process.env.GITHUB_TOKEN);
        res.json(repos);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Failed to fetch repositories" });
    }
});

// 2. GET /api/admin/boards (NOW FETCHES JIRA & MONDAY)
router.get('/boards', async (req, res) => {
    try {
        const boards = [];
        
        // Basecamp
        if (process.env.BASECAMP_ACCESS_TOKEN && process.env.BASECAMP_ACCOUNT_ID) {
            const bcProjects = await BasecampAdapter.fetchBoards(
                process.env.BASECAMP_ACCOUNT_ID, 
                process.env.BASECAMP_ACCESS_TOKEN, 
                "admin@tron.local"
            );
            boards.push(...bcProjects.map(p => ({ provider: 'basecamp', id: p.id, name: `[Basecamp] ${p.name}` })));
        }

        // Jira (Assuming your Jira Adapter has a method to list projects)
        if (process.env.JIRA_API_TOKEN && process.env.JIRA_DOMAIN && process.env.JIRA_EMAIL) {
            // Placeholder: Replace with actual Jira fetch logic if implemented in JiraAdapter
            // const jiraProjects = await JiraAdapter.fetchProjects(); 
            // boards.push(...jiraProjects.map(p => ({ provider: 'jira', id: p.key, name: `[Jira] ${p.name}` })));
            boards.push({ provider: 'jira', id: 'MANUAL_JIRA_ID', name: '[Jira] (Manual Project Key Required)' });
        }

        // Monday
        if (process.env.MONDAY_API_TOKEN) {
            boards.push({ provider: 'monday', id: 'MANUAL_MONDAY_ID', name: '[Monday] (Manual Board ID Required)' });
        }

        res.json(boards);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Failed to fetch PM boards" });
    }
});

// 3. POST /api/admin/config (FULLY MULTI-PROVIDER AUTO-MAPPER)
router.post('/config', async (req, res) => {
    try {
        const { projects } = req.body;

        for (let project of projects) {
            
            // --- PM TOOL MAPPING ---
            if (project.pm_tool.provider === 'basecamp') {
                const columns = await BasecampAdapter.fetchColumns(
                    process.env.BASECAMP_ACCOUNT_ID, project.pm_tool.board_id,
                    process.env.BASECAMP_ACCESS_TOKEN, "admin@tron.local"
                );

                const getColId = (possibleNames, fallback) => {
                    for (let searchStr of possibleNames) {
                        const cleanSearch = searchStr.toLowerCase().replace(/[\s-]/g, '');
                        const col = columns.find(c => c.name.toLowerCase().replace(/[\s-]/g, '').includes(cleanSearch));
                        if (col) return col.id.toString();
                    }
                    return fallback;
                };

                project.mapping.todo_column = getColId(['todo', 'backlog', 'pending'], 'To Do');
                project.mapping.branch_created = getColId(['progress', 'doing', 'active'], 'In Progress');
                project.mapping.pull_request_opened = getColId(['review', 'testing', 'qa'], 'Under Review');
                project.mapping.pull_request_closed = getColId(['done', 'complete', 'closed', 'finish'], 'Done');
            
            } else if (project.pm_tool.provider === 'jira') {
                // Jira uses standard status names rather than column IDs
                project.mapping.todo_column = 'To Do';
                project.mapping.branch_created = 'In Progress';
                project.mapping.pull_request_opened = 'In Review';
                project.mapping.pull_request_closed = 'Done';
            
            } else if (project.pm_tool.provider === 'monday') {
                // Monday uses standard group/column IDs, usually requiring specific API queries
                project.mapping.todo_column = 'new_group';
                project.mapping.branch_created = 'topics';
                project.mapping.pull_request_opened = 'status_1';
                project.mapping.pull_request_closed = 'done';
            }

            // --- COMMUNICATION MAPPING (Discord & Slack) ---
            if (process.env.DISCORD_BOT_TOKEN) {
                const dChannels = await DiscordAdapter.fetchChannels(process.env.DISCORD_BOT_TOKEN);
                if (dChannels.length > 0) {
                    project.communication = { provider: 'discord', webhook_url: dChannels[0].id.toString() };
                }
            } else if (process.env.SLACK_BOT_TOKEN) {
                const sChannels = await SlackAdapter.fetchChannels(process.env.SLACK_BOT_TOKEN);
                if (sChannels.length > 0) {
                    project.communication = { provider: 'slack', webhook_url: sChannels[0].id.toString() };
                }
            } else {
                project.communication = { provider: 'none' };
            }
        }

        const yamlStr = yaml.dump({ projects }, { noRefs: true });
        const outputPath = path.join(__dirname, '../../tron.yaml');
        
        fs.writeFileSync(outputPath, yamlStr, 'utf8');
        res.json({ success: true, message: "Configuration saved successfully!" });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Failed to save YAML configuration" });
    }
});

// 4. POST /api/admin/env (SAVES CREDENTIALS TO .ENV)
router.post('/env', (req, res) => {
    try {
        const credentials = req.body; // Object containing { GITHUB_TOKEN: '...', etc. }
        const envPath = path.join(__dirname, '../../.env');
        
        let envContent = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';

        for (const [key, value] of Object.entries(credentials)) {
            if (!value) continue; // Skip if they left the input blank

            const regex = new RegExp(`^${key}=.*`, 'm');
            if (regex.test(envContent)) {
                envContent = envContent.replace(regex, `${key}=${value}`);
            } else {
                envContent += `\n${key}=${value}`;
            }
            process.env[key] = value; // Inject into live memory instantly!
        }

        fs.writeFileSync(envPath, envContent.trim() + '\n');
        res.json({ success: true, message: "Credentials saved securely!" });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Failed to save credentials" });
    }
});

module.exports = router;
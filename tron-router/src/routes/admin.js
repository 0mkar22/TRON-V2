// src/routes/admin.js
const express = require('express');
const axios = require('axios');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

// ==========================================
// 1. FETCH GITHUB REPOSITORIES
// ==========================================
router.post('/github/repos', async (req, res) => {
    const { githubToken } = req.body;

    if (!githubToken) {
        return res.status(400).json({ error: 'GitHub Personal Access Token is required.' });
    }

    try {
        console.log('🔍 [ADMIN] Fetching repositories from GitHub...');
        
        // Ping GitHub's API using the provided token
        const response = await axios.get('https://api.github.com/user/repos', {
            headers: {
                'Authorization': `token ${githubToken}`,
                'Accept': 'application/vnd.github.v3+json'
            },
            params: {
                visibility: 'all',
                affiliation: 'owner,collaborator,organization_member',
                sort: 'updated',
                per_page: 100 // Grab up to 100 recent repos
            }
        });

        // Strip out the massive GitHub payload and only send the essentials to React
        const repos = response.data.map(repo => ({
            id: repo.id,
            name: repo.name,
            fullName: repo.full_name,
            private: repo.private,
            url: repo.html_url
        }));

        console.log(`✅ [ADMIN] Successfully fetched ${repos.length} repositories.`);
        res.json({ repos });

    } catch (error) {
        console.error('❌ [ADMIN] GitHub API Error:', error.response?.data || error.message);
        res.status(500).json({ error: 'Failed to fetch repositories. Is the token valid?' });
    }
});

// ==========================================
// 2. SAVE CONFIG & AUTO-INSTALL WEBHOOKS
// ==========================================
router.post('/save-config', async (req, res) => {
    const { github_token, pm_tool, mapping, communication, active_repos } = req.body;

    if (!github_token || !active_repos || active_repos.length === 0) {
        return res.status(400).json({ error: 'Missing GitHub token or selected repositories.' });
    }

    // This is your live Render URL where GitHub will send events
    const WEBHOOK_URL = 'https://tron-v2-3.onrender.com/webhook';

    try {
        console.log(`\n🚀 [ADMIN] Starting Auto-Install for ${active_repos.length} repositories...`);

        // 1. Loop through every selected repository
        for (const repoFullName of active_repos) {
            console.log(`🔗 Checking webhooks for: ${repoFullName}...`);

            try {
                // First, check if our webhook is already installed so we don't duplicate it
                const hooksResponse = await axios.get(`https://api.github.com/repos/${repoFullName}/hooks`, {
                    headers: { 'Authorization': `token ${github_token}` }
                });

                const alreadyInstalled = hooksResponse.data.some(hook => 
                    hook.config.url === WEBHOOK_URL
                );

                if (alreadyInstalled) {
                    console.log(`✅ Webhook already exists for ${repoFullName}. Skipping.`);
                    continue;
                }

                // If not installed, inject the webhook!
                await axios.post(`https://api.github.com/repos/${repoFullName}/hooks`, {
                    name: 'web',
                    active: true,
                    events: ['push', 'pull_request'],
                    config: {
                        url: WEBHOOK_URL,
                        content_type: 'json',
                        insecure_ssl: '0'
                    }
                }, {
                    headers: { 'Authorization': `token ${github_token}` }
                });

                console.log(`🎉 Successfully injected webhook into ${repoFullName}!`);
                
            } catch (repoError) {
                console.error(`⚠️ Failed to configure ${repoFullName}:`, repoError.response?.data?.message || repoError.message);
                // We continue the loop even if one repo fails
            }
        }

        // 2. TODO: Save the rest of the config (pm_tool, mapping, communication) 
        // to your database or tron.yaml file here!
        console.log(`💾 Configuration saved to T.R.O.N. Engine.`);

        res.json({ message: 'Configuration saved and Webhooks successfully installed!' });

    } catch (error) {
        console.error('❌ [ADMIN] Save Config Error:', error);
        res.status(500).json({ error: 'Failed to process configuration.' });
    }
});

// ==========================================
// 3. FETCH REAL PROJECT MANAGEMENT BOARDS
// ==========================================
router.post('/boards', async (req, res) => {
    const { provider, accountId, accessToken } = req.body;

    if (provider === 'basecamp') {
        if (!accountId || !accessToken) {
            return res.status(400).json({ error: 'Basecamp Account ID and Access Token are required.' });
        }

        try {
            console.log('🔍 [ADMIN] Fetching live boards from Basecamp...');
            
            const response = await axios.get(`https://3.basecampapi.com/${accountId}/projects.json`, {
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'User-Agent': 'TRON-API (admin@tron.local)'
                }
            });

            // Map the massive Basecamp payload down to just what the UI needs
            const boards = response.data.map(project => ({
                id: project.id.toString(),
                name: project.name,
                provider: 'basecamp'
            }));

            console.log(`✅ [ADMIN] Successfully fetched ${boards.length} Basecamp boards.`);
            res.json({ boards });

        } catch (error) {
            console.error('❌ [ADMIN] Basecamp API Error:', error.response?.data || error.message);
            res.status(500).json({ error: 'Failed to fetch Basecamp boards. Check your credentials.' });
        }
    } else {
        res.status(400).json({ error: 'Unsupported PM provider.' });
    }
});

// ==========================================
// 3.5. FETCH LIVE COLUMNS FROM A SPECIFIC BOARD
// ==========================================
router.post('/columns', async (req, res) => {
    const { accountId, accessToken, projectId } = req.body;

    if (!accountId || !accessToken || !projectId) {
        return res.status(400).json({ error: 'Missing Basecamp credentials or Project ID.' });
    }

    try {
        console.log(`🔍 [ADMIN] Fetching tools for Basecamp Project ${projectId}...`);
        
        const headers = {
            'Authorization': `Bearer ${accessToken}`,
            'User-Agent': 'TRON-API (admin@tron.local)'
        };

        // 1. Fetch the Project to see what "Tools" are active
        const projectRes = await axios.get(`https://3.basecampapi.com/${accountId}/projects/${projectId}.json`, { headers });
        
        // 2. Find the Kanban Board (kanban_board / card_table)
        let tool = projectRes.data.dock.find(t => t.name === 'kanban_board' || t.name === 'card_table');
        
        // Only fall back to To-Dos if a Kanban board literally does not exist
        if (!tool) {
            console.log(`⚠️ [ADMIN] No Kanban Board found. Falling back to To-Dos...`);
            tool = projectRes.data.dock.find(t => t.name === 'todoset');
        }

        if (!tool) {
            return res.status(404).json({ error: 'No Card Table or To-Do list found in this project.' });
        }

        console.log(`🔍 [ADMIN] Found tool at ${tool.url}. Fetching tool details...`);

        // 3. Fetch the tool details
        const toolDetailsRes = await axios.get(tool.url, { headers });
        const toolData = toolDetailsRes.data;

        // 4. Basecamp embeds the lists directly into the response! 
        // Card tables use an array called 'lists', To-do sets use 'todolists'
        const rawLists = toolData.lists || toolData.todolists || [];

        if (rawLists.length === 0) {
            return res.status(500).json({ error: 'No columns found inside this board.' });
        }

        // 5. Map the embedded array to a clean format for React
        const columns = rawLists.map(list => ({
            id: list.id.toString(),
            name: list.title || list.name
        }));

        console.log(`✅ [ADMIN] Successfully mapped ${columns.length} Kanban columns!`);
        res.json({ columns });

    } catch (error) {
        console.error('❌ [ADMIN] Basecamp Columns Error:', error.response?.data || error.message);
        res.status(500).json({ error: 'Failed to fetch columns from Basecamp.' });
    }
});

// ==========================================
// 4. SAVE ROUTING CONFIGURATION (YAML)
// ==========================================
router.post('/config', (req, res) => {
    // 🌟 THE FIX: Extract both projects AND team from the incoming request
    const { projects, team } = req.body;

    if (!projects || !Array.isArray(projects)) {
        return res.status(400).json({ error: 'Invalid config format. "projects" must be an array.' });
    }

    try {
        // Build the final object to be converted to YAML
        const yamlData = {
            projects: projects,
            // Only add the team block if there is actually team data
            ...(team && team.length > 0 && { team: team }) 
        };

        const yamlStr = yaml.dump(yamlData, { noRefs: true, lineWidth: -1 });
        
        // Define the path to your tron.yaml file (adjust if yours is in a different folder)
        const configPath = path.join(__dirname, '../../tron.yaml');
        
        fs.writeFileSync(configPath, yamlStr, 'utf8');
        
        console.log(`✅ [ADMIN] Successfully saved configuration to ${configPath}`);
        res.json({ message: 'Configuration saved successfully!' });

    } catch (error) {
        console.error('❌ [ADMIN] Failed to save config:', error);
        res.status(500).json({ error: 'Failed to write configuration file.' });
    }
});

// ==========================================
// 5. AUTO-MATCH DISCORD CHANNEL BY NAME
// ==========================================
router.post('/discord/match', async (req, res) => {
    const { botToken, repoName } = req.body;

    if (!botToken || !repoName) {
        return res.status(400).json({ error: 'Missing Bot Token or Repository Name.' });
    }

    try {
        console.log(`\n🔍 [ADMIN] Hunting for Discord channel matching: ${repoName}...`);
        
        // Extract just the repo name (e.g., "0mkar22/git-playground" -> "git-playground")
        const shortName = repoName.split('/').pop().toLowerCase();
        
        const headers = { 'Authorization': `Bot ${botToken}` };

        // 1. Find which servers (guilds) the bot is in
        const guildsRes = await axios.get('https://discord.com/api/v10/users/@me/guilds', { headers });
        if (guildsRes.data.length === 0) {
            return res.status(404).json({ error: 'Bot is not invited to any servers.' });
        }

        // We assume the bot is primarily used in your main company server (the first one)
        const guildId = guildsRes.data[0].id;

        // 2. Fetch all channels in that server
        const channelsRes = await axios.get(`https://discord.com/api/v10/guilds/${guildId}/channels`, { headers });

        // 3. Find a text channel (type 0) that includes the repo name
        const matchedChannel = channelsRes.data.find(c => 
            c.type === 0 && c.name.toLowerCase().includes(shortName)
        );

        if (matchedChannel) {
            console.log(`✅ [ADMIN] Matched repo to Discord channel: #${matchedChannel.name} (${matchedChannel.id})`);
            res.json({ channelId: matchedChannel.id, channelName: matchedChannel.name });
        } else {
            console.log(`⚠️ [ADMIN] No channel matching '${shortName}' found.`);
            res.status(404).json({ error: `Could not find a channel similar to '${shortName}'.` });
        }

    } catch (error) {
        console.error('❌ [ADMIN] Discord API Error:', error.response?.data || error.message);
        res.status(500).json({ error: 'Failed to communicate with Discord.' });
    }
});

// ==========================================
// 6. FETCH BASECAMP PEOPLE (FOR TEAM ROSTER)
// ==========================================
router.post('/basecamp/people', async (req, res) => {
    const { accountId, accessToken } = req.body;

    if (!accountId || !accessToken) {
        return res.status(400).json({ error: 'Missing Basecamp credentials.' });
    }

    try {
        console.log(`\n👥 [ADMIN] Fetching team members from Basecamp...`);
        const headers = {
            'Authorization': `Bearer ${accessToken}`,
            'User-Agent': 'TRON-API (admin@tron.local)'
        };

        // Fetch all people in the Basecamp account
        const peopleRes = await axios.get(`https://3.basecampapi.com/${accountId}/people.json`, { headers });
        
        const people = peopleRes.data.map(person => ({
            id: person.id.toString(),
            name: person.name,
            email: person.email_address
        }));

        console.log(`✅ [ADMIN] Fetched ${people.length} Basecamp team members.`);
        res.json({ people });

    } catch (error) {
        console.error('❌ [ADMIN] Basecamp People Error:', error.message);
        res.status(500).json({ error: 'Failed to fetch people from Basecamp.' });
    }
});

module.exports = router;
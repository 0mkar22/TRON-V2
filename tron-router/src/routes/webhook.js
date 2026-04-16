const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const axios = require('axios');

// Helper function to read the latest tron.yaml file
function getConfig() {
    try {
        const configPath = path.join(__dirname, '../../tron.yaml');
        const fileContents = fs.readFileSync(configPath, 'utf8');
        return yaml.load(fileContents);
    } catch (e) {
        console.error('❌ [TRON ENGINE] Could not read tron.yaml:', e.message);
        return null;
    }
}

// ==========================================
// 🚀 THE MAIN GITHUB LISTENER
// ==========================================
router.post('/github', async (req, res) => {
    // 1. Acknowledge GitHub immediately so it doesn't timeout
    res.status(200).send('Webhook received');

   const githubEvent = req.headers['x-github-event'];
    const payload = req.body || {}; // 🌟 SAFETY NET: Fallback to empty object if undefined
    const config = getConfig();

    if (!config) return;

    console.log(`\n🔔 [TRON ENGINE] Received GitHub Event: ${githubEvent}`);

    // If payload is mysteriously empty, log it and stop so we don't crash
    if (Object.keys(payload).length === 0) {
        return console.log(`⚠️ [TRON ENGINE] Payload is empty. Make sure express.json() is configured correctly.`);
    }

    // ==========================================
    // SCENARIO 1: A DEVELOPER CREATES A BRANCH
    // ==========================================
    if (githubEvent === 'create' && payload.ref_type === 'branch') {
        const branchName = payload.ref; // e.g., "0mkar22/9641640739-fix-auth"
        const repoFullName = payload.repository.full_name;
        const senderUsername = payload.sender.login;

        console.log(`🌿 [TRON ENGINE] New branch created: ${branchName} in ${repoFullName}`);

        // 2. Find this repository in our tron.yaml rules
        const projectRule = config.projects.find(p => p.repo === repoFullName);
        if (!projectRule) {
            return console.log(`⚠️ No routing rules found for ${repoFullName}. Ignoring.`);
        }

        // 3. Parse the branch name using Regex!
        // Matches: username / basecampId - description
        const branchRegex = /^([^/]+)\/(\d+)-(.+)$/;
        const match = branchName.match(branchRegex);

        if (!match) {
            return console.log(`⚠️ Branch name '${branchName}' does not match the required format. Ignoring.`);
        }

        const [_, parsedUser, taskId, description] = match;
        console.log(`🎯 [TRON ENGINE] Parsed Task ID: ${taskId} | User: ${parsedUser}`);

        // 4. Look up the user in the Team Identity Roster
        const teamMember = config.team?.find(t => t.github === senderUsername);
        
        if (teamMember && teamMember.basecamp_id) {
            console.log(`👤 [TRON ENGINE] Identity Match! GitHub '${senderUsername}' is Basecamp ID '${teamMember.basecamp_id}'`);
            
            // 🔥 THE ACTUAL BASECAMP API EXECUTION 🔥
            try {
                // Pull securely from the .env file
                const BASECAMP_ACCOUNT_ID = process.env.BASECAMP_ACCOUNT_ID; 
                const BASECAMP_ACCESS_TOKEN = process.env.BASECAMP_ACCESS_TOKEN;
                
                if (!BASECAMP_ACCOUNT_ID || !BASECAMP_ACCESS_TOKEN) {
                    return console.error(`❌ [TRON ENGINE] Missing Basecamp credentials in .env file!`);
                }

                const headers = {
                    'Authorization': `Bearer ${BASECAMP_ACCESS_TOKEN}`,
                    'User-Agent': 'TRON-API (admin@tron.local)',
                    'Content-Type': 'application/json'
                };

                const projectId = projectRule.pm_tool.board_id;
                const inProgressColumnId = projectRule.mapping.branch_created;

                // ==========================================
                // STEP 1: Assign the user to the card
                // ==========================================
                const updateUrl = `https://3.basecampapi.com/${BASECAMP_ACCOUNT_ID}/buckets/${projectId}/card_tables/cards/${taskId}.json`;
                
                await axios.put(updateUrl, {
                    assignee_ids: [teamMember.basecamp_id]
                }, { headers });
                
                console.log(`✅ [TRON ENGINE] Assigned Basecamp ID ${teamMember.basecamp_id} to card ${taskId}`);

                // ==========================================
                // STEP 2: Move the card to the "In Progress" column
                // ==========================================
                const moveUrl = `https://3.basecampapi.com/${BASECAMP_ACCOUNT_ID}/buckets/${projectId}/card_tables/cards/${taskId}/moves.json`;
                
                // 🔥 The Boss Feature: position 1 bumps it to the top!
                await axios.post(moveUrl, {
                    column_id: inProgressColumnId,
                    position: 1 
                }, { headers });

                console.log(`✅ [TRON ENGINE] BOOM! Card ${taskId} successfully moved to the 'In Progress' column!`);

            } catch (err) {
                console.error(`❌ [TRON ENGINE] Basecamp Update Error:`, err.response?.data || err.message);
            }
            
        } else {
            console.log(`⚠️ Could not find Basecamp ID for GitHub user '${senderUsername}' in the Roster.`);
        }
    }
});

module.exports = router;
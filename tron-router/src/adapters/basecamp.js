// src/adapters/basecamp.js
const axios = require('axios');
const fs = require('fs');
const path = require('path');

// ==========================================
// INTERNAL UTILITIES: TOKEN MANAGEMENT
// ==========================================

function updateEnvToken(key, newValue) {
    // This points to the .env file in the root of your tron-router folder
    const envPath = path.join(__dirname, '../../.env'); 
    
    let envFile = fs.readFileSync(envPath, 'utf8');
    const regex = new RegExp(`^${key}=.*$`, 'm');
    
    if (regex.test(envFile)) {
        envFile = envFile.replace(regex, `${key}=${newValue}`);
    } else {
        envFile += `\n${key}=${newValue}`;
    }
    
    fs.writeFileSync(envPath, envFile);
    process.env[key] = newValue; // Update live memory
}

async function refreshBasecampTokenV2() {
    console.log('🔄 Basecamp token expired. Attempting to refresh...');
    
    const response = await axios.post('https://launchpad.37signals.com/authorization/token', null, {
        params: {
            type: 'refresh',
            refresh_token: process.env.BASECAMP_REFRESH_TOKEN,
            client_id: process.env.BASECAMP_CLIENT_ID,
            client_secret: process.env.BASECAMP_CLIENT_SECRET,
            redirect_uri: process.env.BASECAMP_REDIRECT_URI
        }
    });

    const newAccessToken = response.data.access_token;
    updateEnvToken('BASECAMP_ACCESS_TOKEN', newAccessToken);

    console.log('✅ Basecamp token successfully refreshed and saved to .env!');
    return newAccessToken;
}

class BasecampAdapter {
    static getBaseConfig() {
        return {
            headers: {
                'Authorization': `Bearer ${process.env.BASECAMP_ACCESS_TOKEN}`,
                'Content-Type': 'application/json',
                'User-Agent': 'TRON-API (admin@tron.local)'
            }
        };
    }

    static getBaseUrl(projectId) {
        return `https://3.basecampapi.com/${process.env.BASECAMP_ACCOUNT_ID}/buckets/${projectId}`;
    }

    // ==========================================
    // 🌟 THE IMMUNE SYSTEM (Self-Healing Wrapper)
    // ==========================================
    static async executeWithRetry(apiCallCallback) {
        try {
            // Attempt the API call normally
            return await apiCallCallback();
        } catch (error) {
            // If the token is expired (401), intercept it before failing!
            if (error.response && error.response.status === 401) {
                console.log('⚠️ [BASECAMP] Caught 401 Unauthorized. Triggering self-healing flow...');
                
                // 1. Refresh the token and save it to memory/env
                await refreshBasecampTokenV2();
                
                // 2. Retry the EXACT same API call. 
                // Because apiCallCallback() calls getBaseConfig() fresh, it will use the new token automatically!
                console.log('♻️ [BASECAMP] Retrying API call with new token...');
                return await apiCallCallback();
            }
            
            // If it failed for a different reason (like a bad ID), throw normally
            throw error;
        }
    }

    // ==========================================
    // 1. Fetch Active Tasks
    // ==========================================
    static async fetchActiveTasks(projectId, columnId) {
        if (!columnId || columnId === 'undefined') {
            console.error('❌ [BASECAMP] Column ID is undefined. Check your tron.yaml mapping.');
            return [];
        }

        try {
            // Wrap the Axios call in our new self-healing executor
            const response = await this.executeWithRetry(() => 
                axios.get(
                    `${this.getBaseUrl(projectId)}/card_tables/lists/${columnId}/cards.json`,
                    this.getBaseConfig()
                )
            );

            return response.data.map(card => ({
                id: card.id.toString(),
                title: card.title,
                description: card.content || "No description provided." 
            }));
        } catch (error) {
            console.error(`❌ [BASECAMP] Fetch Tasks Error:`, error.response?.data || error.message);
            return [];
        }
    }

    // ==========================================
    // 2. Resolve Task (The Duplicate Fix)
    // ==========================================
    static async resolveTask(projectId, todoColumnId, taskName) {
        try {
            const trimmedTask = taskName.trim();
            const possibleId = trimmedTask.replace(/\D/g, ''); 

            if (possibleId.length >= 8) {
                console.log(`♻️  [BASECAMP] Reusing existing ID [${possibleId}].`);
                return possibleId;
            }

            const existingTasks = await this.fetchActiveTasks(projectId, todoColumnId);
            const duplicate = existingTasks.find(t => t.title.trim().toLowerCase() === trimmedTask.toLowerCase());

            if (duplicate) {
                console.log(`♻️  [BASECAMP] Task "${trimmedTask}" already exists. Reusing ID [${duplicate.id}].`);
                return duplicate.id;
            }

            console.log(`✨ [BASECAMP] Creating new task: "${trimmedTask}"`);
            
            // Wrap the Axios call in our new self-healing executor
            const response = await this.executeWithRetry(() => 
                axios.post(
                    `${this.getBaseUrl(projectId)}/card_tables/lists/${todoColumnId}/cards.json`,
                    { title: trimmedTask, content: "Created by T.R.O.N." },
                    this.getBaseConfig()
                )
            );

            return response.data.id.toString();
        } catch (error) {
            console.error(`❌ [BASECAMP] Create Task Error:`, error.response?.data || error.message);
            throw error;
        }
    }

    // ==========================================
    // 3. Move Ticket (The 404 & False Positive Fix)
    // ==========================================
    static async updateTicketStatus(ticketId, newColumnId, projectId) {
        try {
            const cleanTicketId = ticketId.toString().replace(/\D/g, '');

            // Wrap the Axios call in our new self-healing executor
            await this.executeWithRetry(() => 
                axios.post(
                    `${this.getBaseUrl(projectId)}/card_tables/cards/${cleanTicketId}/moves.json`,
                    { column_id: newColumnId }, 
                    this.getBaseConfig()
                )
            );
            
            console.log(`✅ [BASECAMP] Moved ticket [${cleanTicketId}] to column [${newColumnId}]`);
        } catch (error) {
            console.error(`❌ [BASECAMP] Move Task Error:`, error.response?.data || error.message);
            throw error; 
        }
    }
}

module.exports = BasecampAdapter;
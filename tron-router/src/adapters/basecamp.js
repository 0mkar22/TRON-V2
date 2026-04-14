// src/adapters/basecamp.js
const axios = require('axios');

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
    // 1. Fetch Active Tasks
    // ==========================================
    static async fetchActiveTasks(projectId, columnId) {
        if (!columnId || columnId === 'undefined') {
            console.error('❌ [BASECAMP] Column ID is undefined. Check your tron.yaml mapping.');
            return [];
        }

        try {
            // Hit the Basecamp Card Tables API specifically
            const response = await axios.get(
                `${this.getBaseUrl(projectId)}/card_tables/lists/${columnId}/cards.json`,
                this.getBaseConfig()
            );

            // Honor the Orchestrator's strict GET contract
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
            
            // 🌟 FIXED: Strip out any "TASK-" prefix to check if they passed a known ID
            const possibleId = trimmedTask.replace(/\D/g, ''); 

            // If it is purely an 8+ digit number, it's an existing Basecamp ID. Reuse it!
            if (possibleId.length >= 8) {
                console.log(`♻️  [BASECAMP] Reusing existing ID [${possibleId}].`);
                return possibleId;
            }

            // Otherwise, it's a "Create New Task" string. Check for duplicates by title.
            const existingTasks = await this.fetchActiveTasks(projectId, todoColumnId);
            const duplicate = existingTasks.find(t => t.title.trim().toLowerCase() === trimmedTask.toLowerCase());

            if (duplicate) {
                console.log(`♻️  [BASECAMP] Task "${trimmedTask}" already exists. Reusing ID [${duplicate.id}].`);
                return duplicate.id;
            }

            console.log(`✨ [BASECAMP] Creating new task: "${trimmedTask}"`);
            const response = await axios.post(
                `${this.getBaseUrl(projectId)}/card_tables/lists/${todoColumnId}/cards.json`,
                { title: trimmedTask, content: "Created by T.R.O.N." },
                this.getBaseConfig()
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
            // 🌟 FIXED: Force the ID to be purely numeric so Basecamp doesn't throw a 404
            const cleanTicketId = ticketId.toString().replace(/\D/g, '');

            // Basecamp Card Tables use a specific 'moves' endpoint
            await axios.post(
                `${this.getBaseUrl(projectId)}/card_tables/cards/${cleanTicketId}/moves.json`,
                { column_id: newColumnId }, 
                this.getBaseConfig()
            );
            console.log(`✅ [BASECAMP] Moved ticket [${cleanTicketId}] to column [${newColumnId}]`);
        } catch (error) {
            console.error(`❌ [BASECAMP] Move Task Error:`, error.response?.data || error.message);
            // 🌟 FIXED: Throw the error so your backend returns a 500 status to VS Code!
            throw error; 
        }
    }
}

module.exports = BasecampAdapter;
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
    // 1. Fetch Active Tasks (The 404 Fix)
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
                title: card.title
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
            // STEP 1: Search the To-Do column for an exact match
            const existingTasks = await this.fetchActiveTasks(projectId, todoColumnId);
            const duplicate = existingTasks.find(t => t.title.trim().toLowerCase() === taskName.trim().toLowerCase());

            if (duplicate) {
                console.log(`♻️  [BASECAMP] Task "${taskName}" already exists. Reusing ID [${duplicate.id}].`);
                return duplicate.id;
            }

            // STEP 2: Only create if no match was found
            console.log(`✨ [BASECAMP] Creating new task: "${taskName}"`);
            const response = await axios.post(
                `${this.getBaseUrl(projectId)}/card_tables/lists/${todoColumnId}/cards.json`,
                { title: taskName, content: "Created by T.R.O.N." },
                this.getBaseConfig()
            );

            return response.data.id.toString();
        } catch (error) {
            console.error(`❌ [BASECAMP] Create Task Error:`, error.response?.data || error.message);
            throw error;
        }
    }

    // ==========================================
    // 3. Move Ticket
    // ==========================================
    static async updateTicketStatus(ticketId, newColumnId, projectId) {
        try {
            // Basecamp Card Tables use a specific 'moves' endpoint
            await axios.post(
                `${this.getBaseUrl(projectId)}/card_tables/cards/${ticketId}/moves.json`,
                { column_id: newColumnId }, 
                this.getBaseConfig()
            );
            console.log(`✅ [BASECAMP] Moved ticket [${ticketId}] to column [${newColumnId}]`);
        } catch (error) {
            console.error(`❌ [BASECAMP] Move Task Error:`, error.response?.data || error.message);
        }
    }
}

module.exports = BasecampAdapter;
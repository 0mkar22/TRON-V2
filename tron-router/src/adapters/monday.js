// tron-router/src/adapters/monday.js
const axios = require('axios');

class MondayAdapter {
    static getHeaders() {
        return {
            'Authorization': process.env.MONDAY_API_TOKEN,
            'Content-Type': 'application/json',
            'API-Version': '2024-01' // Monday requires API versioning
        };
    }

    /**
     * 1. READ: Fetch active tickets for the Go Daemon
     * @param {string} boardId - The Monday.com Board ID (from tron.yaml)
     */
    static async fetchActiveTasks(boardId) {
        console.log(`[MONDAY ADAPTER] Fetching tasks for board: ${boardId}`);
        
        // GraphQL Query to get items from a specific board
        const query = `
        query {
            boards(ids: [${boardId}]) {
                items_page(limit: 50) {
                    items {
                        id
                        name
                    }
                }
            }
        }`;

        try {
            const response = await axios.post('https://api.monday.com/v2', { query }, { headers: this.getHeaders() });
            
            if (response.data.errors) {
                throw new Error(JSON.stringify(response.data.errors));
            }

            const items = response.data.data.boards[0].items_page.items;

            // Map to the universal T.R.O.N. format
            return items.map(item => ({
                id: item.id,
                title: item.name
            }));
        } catch (error) {
            console.error('❌ [MONDAY ADAPTER] Failed to fetch tasks:', error.message);
            return [];
        }
    }

    /**
     * 2. WRITE: Move the ticket status when PR is merged/opened
     * @param {string} itemId - The Monday Item ID
     * @param {string} newStatus - The text status to change to (e.g., "Done", "Working on it")
     * @param {string} boardId - Needed for the GraphQL mutation
     */
    static async updateTicketStatus(itemId, newStatus, boardId) {
        console.log(`[MONDAY ADAPTER] Moving item ${itemId} to status: "${newStatus}"...`);
        
        // GraphQL Mutation to change a status column. 
        // Note: We assume the standard column_id for status is "status". 
        const mutation = `
        mutation {
            change_simple_column_value(
                item_id: ${itemId},
                board_id: ${boardId},
                column_id: "status",
                value: "${newStatus}"
            ) {
                id
            }
        }`;

        try {
            const response = await axios.post('https://api.monday.com/v2', { query: mutation }, { headers: this.getHeaders() });
            
            if (response.data.errors) {
                throw new Error(JSON.stringify(response.data.errors));
            }

            console.log(`✅ [MONDAY ADAPTER] Successfully updated item ${itemId}`);
        } catch (error) {
            console.error(`❌ [MONDAY ADAPTER] Failed to update item:`, error.message);
        }
    }
}

module.exports = MondayAdapter;
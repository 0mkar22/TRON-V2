const axios = require('axios');

class BasecampSyncAdapter {
    static getBaseConfig(token, email) {
        return {
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json',
                'User-Agent': `TRON-Configurator (${email})`
            }
        };
    }

    static async fetchBoards(accountId, token, email) {
        try {
            const url = `https://3.basecampapi.com/${accountId}/projects.json`;
            const response = await axios.get(url, this.getBaseConfig(token, email));
            return response.data;
        } catch (error) {
            console.error("❌ Failed to fetch Basecamp projects:", error.message);
            return [];
        }
    }

    // 🌟 CORRECTED METHOD: Fetch the Kanban Columns for a specific project
    static async fetchColumns(accountId, projectId, token, email) {
        try {
            // 1. Fetch the project details to get the "dock" (list of active tools)
            const projectUrl = `https://3.basecampapi.com/${accountId}/projects/${projectId}.json`;
            const projectResponse = await axios.get(projectUrl, this.getBaseConfig(token, email));
            
            const dock = projectResponse.data.dock || [];
            
            // 2. Find the Card Table inside the dock
            const cardTableTool = dock.find(t => t.name === 'card_table' || t.name === 'kanban_board');
            
            if (!cardTableTool) {
                console.error(`⚠️ No Card Table (Kanban) found in Project ${projectId}. Make sure you have the Card Table tool enabled in Basecamp.`);
                return [];
            }

            // 3. Fetch the specific Card Table URL to get its lists (columns)
            const tableResponse = await axios.get(cardTableTool.url, this.getBaseConfig(token, email));
            
            // 4. Map the lists to standard { id, name } objects
            if (tableResponse.data && tableResponse.data.lists) {
                return tableResponse.data.lists.map(list => ({
                    id: list.id.toString(),
                    name: list.title
                }));
            }
            return [];
            
        } catch (error) {
            console.error(`❌ Failed to fetch Basecamp columns:`, error.response?.data || error.message);
            return [];
        }
    }
}

module.exports = BasecampSyncAdapter;
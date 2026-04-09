const axios = require('axios');

class JiraAdapter {
    static async fetchBoards(domain, email, apiToken) {
        const auth = Buffer.from(`${email}:${apiToken}`).toString('base64');
        const baseUrl = `https://${domain}.atlassian.net/rest/agile/1.0`;
        let allBoards = [];
        let startAt = 0;
        let isLast = false;

        console.log(`[JIRA SYNC] Fetching all Jira Software boards...`);

        while (!isLast) {
            try {
                // 1. Fetch the Boards
                const boardRes = await axios.get(`${baseUrl}/board`, {
                    headers: { 'Authorization': `Basic ${auth}`, 'Accept': 'application/json' },
                    params: { maxResults: 50, startAt: startAt }
                });

                for (const board of boardRes.data.values) {
                    // 2. Fetch the Columns for EACH board
                    try {
                        const configRes = await axios.get(`${baseUrl}/board/${board.id}/configuration`, {
                            headers: { 'Authorization': `Basic ${auth}` }
                        });

                        const columns = configRes.data.columnConfig.columns;
                        
                        // Try to fuzzy-match standard Agile columns to their Jira Status IDs
                        const colMap = {};
                        columns.forEach(col => {
                            const name = col.name.toLowerCase();
                            if (name.includes('to do') || name.includes('backlog')) colMap.todo = col.statuses[0].id;
                            if (name.includes('progress') || name.includes('doing')) colMap.doing = col.statuses[0].id;
                            if (name.includes('review') || name.includes('pr')) colMap.review = col.statuses[0].id;
                            if (name.includes('done') || name.includes('closed')) colMap.done = col.statuses[0].id;
                        });

                        // Only add boards that actually look like Software Kanban boards
                        if (colMap.todo && colMap.doing && colMap.done) {
                            allBoards.push({
                                tool: "jira",
                                id: board.id.toString(),
                                name: board.name,
                                columns: colMap
                            });
                        }
                    } catch (colError) {
                        // Skip boards that the API key doesn't have permission to view
                        continue; 
                    }
                }

                isLast = boardRes.data.isLast;
                startAt += boardRes.data.maxResults;

            } catch (error) {
                console.error(`❌ [JIRA SYNC] Fatal API Error:`, error.message);
                break;
            }
        }
        console.log(`✅ [JIRA SYNC] Successfully mapped ${allBoards.length} Kanban boards.`);
        return allBoards;
    }
}

module.exports = JiraAdapter;
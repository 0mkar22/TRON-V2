const axios = require('axios');

class BasecampAdapter {
    static async fetchBoards(accountId, accessToken, companyEmail) {
        const baseUrl = `https://3.basecampapi.com/${accountId}/projects.json`;
        const headers = {
            'Authorization': `Bearer ${accessToken}`,
            'User-Agent': `T.R.O.N. Enterprise Sync (${companyEmail})` 
        };
        let validBoards = [];

        console.log(`[BASECAMP SYNC] Fetching all Basecamp projects...`);

        try {
            const response = await axios.get(baseUrl, { headers });
            const projects = response.data;
            
            for (const project of projects) {
                const projectId = project.id ? project.id.toString() : "unknown_id";
                
                let mapping = {
                    todo: "NOT_FOUND_TODO_COLUMN",
                    in_progress: "NOT_FOUND_IN_PROGRESS_COLUMN",
                    in_review: "NOT_FOUND_REVIEW_COLUMN",
                    done: "NOT_FOUND_DONE_COLUMN"
                };

                let allLists = [];
                const dock = project.dock || [];

                // 🧠 Traverse the Basecamp "Dock"
                for (const tool of dock) {
                    try {
                        if (tool.name === 'card_table' || tool.name === 'kanban_board') {
                            
                            // 1. Fetch the exact tool URL Basecamp gave us
                            const toolRes = await axios.get(tool.url, { headers });
                            
                            // 🛡️ THE FINAL FIX: The columns are already here inside 'lists'!
                            if (toolRes.data.lists && Array.isArray(toolRes.data.lists)) {
                                allLists = allLists.concat(toolRes.data.lists);
                            }
                        }
                    } catch (err) {
                        console.log(`⚠️ Could not fetch Kanban lists for project: ${project.name}`);
                    }
                }

                // 3. Dynamic Mapping based on Kanban column names
                if (allLists.length > 0) {
                    console.log(`\n🔍 Found Kanban columns in Basecamp Project "${project.name}":`);
                    allLists.forEach(list => console.log(`   - "${list.title || list.name}" (ID: ${list.id})`));

                    allLists.forEach(list => {
                        const title = (list.title || list.name || "").toLowerCase();
                        
                        if (title.includes('todo') || title.includes('to-do') || title.includes('up next') || title.includes('backlog') || title.includes('pending')) {
                            mapping.todo = list.id.toString();
                        } else if (title.includes('progress') || title.includes('doing') || title.includes('active') || title.includes('dev') || title.includes('in-progress')) {
                            mapping.in_progress = list.id.toString();
                        } else if (title.includes('review') || title.includes('pr') || title.includes('testing') || title.includes('qa')) {
                            mapping.in_review = list.id.toString();
                        } else if (title.includes('done') || title.includes('Done') || title.includes('finished') || title.includes('resolved')) {
                            mapping.done = list.id.toString();
                        }
                    });

                    // 🛡️ SMART FALLBACK: Grab by order if keyword failed
                    if (mapping.todo.includes("NOT_FOUND") && allLists.length > 0) mapping.todo = allLists[0].id.toString();
                    if (mapping.in_progress.includes("NOT_FOUND") && allLists.length > 1) mapping.in_progress = allLists[1].id.toString();
                    if (mapping.in_review.includes("NOT_FOUND") && allLists.length > 1) mapping.in_review = allLists[1].id.toString(); 
                    if (mapping.done.includes("NOT_FOUND") && allLists.length > 2) mapping.done = allLists[allLists.length - 1].id.toString();
                }

                validBoards.push({
                    id: projectId,
                    name: project.name,
                    url: project.app_url,
                    tool: 'basecamp',
                    mapping: mapping
                });
            }

            return validBoards;

        } catch (error) {
            console.error(`❌ [BASECAMP SYNC] Error fetching projects: ${error.message}`);
            return [];
        }
    }
    static async fetchColumns(accountId, accessToken, projectId, email = "admin@tron.local") {
        try {
            const api = axios.create({
                baseURL: `https://3.basecampapi.com/${accountId}`,
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'User-Agent': `T.R.O.N. Sync (${email})`
                }
            });

            // 1. Get Card Table ID
            const tablesRes = await api.get(`/buckets/${projectId}/card_tables.json`);
            if (tablesRes.data.length === 0) return [];
            
            const cardTableId = tablesRes.data[0].id;

            // 2. Get Lists (Columns)
            const listsRes = await api.get(`/buckets/${projectId}/card_tables/${cardTableId}/lists.json`);
            
            return listsRes.data.map(col => ({
                id: col.id.toString(),
                name: col.name
            }));
        } catch (error) {
            console.error(`❌ [BASECAMP SYNC] Failed to fetch columns for project ${projectId}:`, error.message);
            return [];
        }
    }
}

module.exports = BasecampAdapter;
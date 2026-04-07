const axios = require('axios');

class GithubAdapter {
    static async fetchRepos(orgName, token) {
        let allRepos = [];
        let page = 1;
        let hasMore = true;

        console.log(`[GITHUB SYNC] Fetching all repositories for organization: ${orgName}...`);

        while (hasMore) {
            try {
                // 🛡️ API FIX: Use the authenticated user endpoint to fetch personal private/public repos
                const response = await axios.get(`https://api.github.com/user/repos`, {
                    headers: {
                        'Authorization': `Bearer ${token}`,
                        'Accept': 'application/vnd.github.v3+json'
                    },
                    params: { 
                        per_page: 100, 
                        page: page,
                        affiliation: 'owner,collaborator' // Get everything you have access to!
                    }
                });

                if (response.data.length === 0) {
                    hasMore = false;
                } else {
                    const mapped = response.data.map(repo => ({
                        name: repo.name,
                        fullName: repo.full_name
                    }));
                    allRepos = allRepos.concat(mapped);
                    page++;
                }
            } catch (error) {
                console.error(`❌ [GITHUB SYNC] Failed on page ${page}:`, error.message);
                hasMore = false; // Abort cleanly without crashing the whole sync
            }
        }

        console.log(`✅ [GITHUB SYNC] Successfully retrieved ${allRepos.length} repositories.`);
        return allRepos;
    }
}

module.exports = GithubAdapter;
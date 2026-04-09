const axios = require('axios');

class GithubAdapter {
    // 🛡️ THE FIX: Removed orgName parameter, it just takes the token now
    static async fetchRepos(token) {
        let allRepos = [];
        let page = 1;
        let hasMore = true;

        console.log(`[GITHUB SYNC] Fetching all accessible repositories...`);

        while (hasMore) {
            try {
                const response = await axios.get(`https://api.github.com/user/repos`, {
                    headers: {
                        'Authorization': `Bearer ${token}`,
                        'Accept': 'application/vnd.github.v3+json'
                    },
                    params: { 
                        per_page: 100, 
                        page: page,
                        affiliation: 'owner,collaborator' 
                    }
                });

                if (response.data.length === 0) {
                    hasMore = false;
                } else {
                    const mapped = response.data.map(repo => ({
                        name: repo.name,
                        full_name: repo.full_name // Changed fullName to full_name to match enterprise-sync.js
                    }));
                    allRepos = allRepos.concat(mapped);
                    page++;
                }
            } catch (error) {
                console.error(`❌ [GITHUB SYNC] Failed on page ${page}:`, error.message);
                hasMore = false; 
            }
        }

        console.log(`✅ [GITHUB SYNC] Successfully retrieved ${allRepos.length} repositories.`);
        return allRepos;
    }
}

module.exports = GithubAdapter;
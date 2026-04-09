// tron-router/src/adapters/jira.js
const axios = require('axios');

class JiraAdapter {
    /**
     * Helper to generate Jira Auth Headers
     */
    static getHeaders() {
        // Jira requires a Base64 encoded string of "email:api_token"
        const auth = Buffer.from(`${process.env.JIRA_EMAIL}:${process.env.JIRA_API_TOKEN}`).toString('base64');
        return {
            'Authorization': `Basic ${auth}`,
            'Accept': 'application/json',
            'Content-Type': 'application/json'
        };
    }

    /**
     * 1. READ: Fetch active tickets for the Go Daemon
     * @param {string} projectKey - The Jira Project Key (e.g., "TRON", "ENG")
     */
    static async fetchActiveTasks(projectKey) {
        console.log(`[JIRA ADAPTER] Fetching active tasks for project: ${projectKey}`);
        
        // JQL: Get issues in the project that are NOT Done.
        const jql = `project = ${projectKey} AND statusCategory != Done ORDER BY updated DESC`;
        const url = `https://${process.env.JIRA_DOMAIN}.atlassian.net/rest/api/3/search?jql=${encodeURIComponent(jql)}&maxResults=15`;

        try {
            const response = await axios.get(url, { headers: this.getHeaders() });
            
            // Map Jira's complex response into the universal format the Go Daemon expects
            const tasks = response.data.issues.map(issue => ({
                id: issue.key, // e.g., TRON-123
                title: issue.fields.summary
            }));

            return tasks;
        } catch (error) {
            console.error('❌ [JIRA ADAPTER] Failed to fetch tasks:', error.response?.data || error.message);
            return [];
        }
    }

    /**
     * 2. WRITE: Move the ticket to a specific status based on tron.yaml
     */
    static async updateTicketStatus(issueKey, newStatus) {
        console.log(`[JIRA ADAPTER] Attempting to move ${issueKey} to "${newStatus}"...`);
        const domain = process.env.JIRA_DOMAIN;
        
        try {
            const transitionsUrl = `https://${domain}.atlassian.net/rest/api/3/issue/${issueKey}/transitions`;
            const transitionsRes = await axios.get(transitionsUrl, { headers: this.getHeaders() });
            
            // Look for a Jira transition that matches the text from tron.yaml (case-insensitive)
            const targetTransition = transitionsRes.data.transitions.find(t => 
                t.name.toLowerCase() === newStatus.toLowerCase()
            );

            if (!targetTransition) {
                console.warn(`⚠️ [JIRA ADAPTER] Status "${newStatus}" not found for ${issueKey}. Available statuses: ${transitionsRes.data.transitions.map(t=>t.name).join(', ')}`);
                return; // Graceful exit without crashing the worker
            }

            await axios.post(transitionsUrl, {
                transition: { id: targetTransition.id }
            }, { headers: this.getHeaders() });

            console.log(`✅ [JIRA ADAPTER] Successfully moved ${issueKey} to ${newStatus}`);
        } catch (error) {
            console.error(`❌ [JIRA ADAPTER] Failed to complete task:`, error.response?.data || error.message);
        }
    }
}

module.exports = JiraAdapter;
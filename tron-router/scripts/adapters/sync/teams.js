// tron-router/scripts/adapters/sync/teams.js
const axios = require('axios');

class TeamsAdapter {
    
    // ==========================================
    // 1. SYNC FUNCTION (Used by enterprise-sync.js)
    // ==========================================
    static async fetchChannels(graphApiToken) {
        console.log(`[TEAMS SYNC] ⚠️ Microsoft Teams channels cannot be easily synced via simple Bot Tokens.`);
        console.log(`[TEAMS SYNC] Teams requires Azure Graph API (Tenant ID, Client ID). We recommend using manual Webhook URLs in tron.yaml for Teams.`);
        
        // If you eventually set up MS Graph API, the logic goes here:
        // 1. GET https://graph.microsoft.com/v1.0/groups (to get Teams)
        // 2. GET https://graph.microsoft.com/v1.0/teams/{id}/channels (to get Channels)
        
        return []; 
    }

    // ==========================================
    // 2. BROADCAST FUNCTION (Used by messenger.js)
    // ==========================================
    static async sendToTeams(webhookUrl, title, description, url, colorHex) {
        console.log(`🤖 [TEAMS ADAPTER] Formatting MessageCard...`);

        const payload = {
            "@type": "MessageCard",
            "@context": "http://schema.org/extensions",
            "themeColor": colorHex ? colorHex.replace('#', '') : "0076D7",
            "summary": title,
            "sections": [{
                "activityTitle": `🚀 T.R.O.N. Intel: **${title}**`,
                "activitySubtitle": "T.R.O.N. Local Watcher • AI Pipeline",
                "text": description,
                "potentialAction": [{
                    "@type": "OpenUri",
                    "name": "View on GitHub",
                    "targets": [{"os": "default", "uri": url}]
                }]
            }]
        };

        try {
            if (!webhookUrl.startsWith('http')) {
                throw new Error("Teams Adapter requires a full Incoming Webhook URL.");
            }

            await axios.post(webhookUrl, payload);
            console.log(`✅ [TEAMS ADAPTER] Successfully broadcasted to the team!`);
        } catch (error) {
            console.error(`❌ [TEAMS ADAPTER] Failed to broadcast:`, error.message);
        }
    }
}

module.exports = TeamsAdapter;
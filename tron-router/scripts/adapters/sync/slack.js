// tron-router/scripts/adapters/sync/slack.js
const axios = require('axios');

class SlackAdapter {
    
    // ==========================================
    // 1. SYNC FUNCTION (Used by enterprise-sync.js)
    // ==========================================
    static async fetchChannels(botToken) {
        let allChannels = [];
        const headers = { 'Authorization': `Bearer ${botToken}` };

        console.log(`[SLACK SYNC] Fetching Slack Workspaces & Channels...`);

        try {
            // Fetch public and private channels the bot has been invited to
            const response = await axios.get('https://slack.com/api/conversations.list?types=public_channel,private_channel', { headers });

            if (!response.data.ok) {
                throw new Error(response.data.error);
            }

            // Map them to the universal T.R.O.N. format
            const mapped = response.data.channels
                .filter(c => !c.is_archived) // Ignore archived channels
                .map(c => ({
                    tool: "slack",
                    id: c.id,
                    name: c.name,
                    webhook: c.id // The runtime Messenger will use this Channel ID to POST the message
                }));

            allChannels = mapped;
            console.log(`✅ [SLACK SYNC] Successfully mapped ${allChannels.length} text channels.`);
            
        } catch (error) {
            console.error(`❌ [SLACK SYNC] Fatal API Error:`, error.message);
        }

        return allChannels;
    }

    // ==========================================
    // 2. BROADCAST FUNCTION (Used by messenger.js)
    // ==========================================
    static async sendToSlack(webhookUrl, title, description, url, colorHex) {
        console.log(`🤖 [SLACK ADAPTER] Formatting rich block...`);

        const payload = {
            attachments: [
                {
                    fallback: title,
                    color: colorHex || "#36a64f",
                    title: `🚀 T.R.O.N. Intel: ${title}`,
                    title_link: url,
                    text: description,
                    footer: "T.R.O.N. Local Watcher • AI Pipeline",
                    ts: Math.floor(Date.now() / 1000)
                }
            ]
        };

        try {
            // Check if the webhookUrl is actually a Channel ID (e.g., C1234567) or a standard Webhook URL
            const isChannelId = !webhookUrl.startsWith('http');

            if (isChannelId) {
                // Post using the Slack Bot API
                payload.channel = webhookUrl;
                await axios.post('https://slack.com/api/chat.postMessage', payload, {
                    headers: {
                        'Authorization': `Bearer ${process.env.SLACK_BOT_TOKEN}`,
                        'Content-Type': 'application/json'
                    }
                });
            } else {
                // Post using a standard Slack Webhook
                await axios.post(webhookUrl, payload);
            }
            console.log(`✅ [SLACK ADAPTER] Successfully broadcasted to the team!`);
        } catch (error) {
            console.error(`❌ [SLACK ADAPTER] Failed to broadcast:`, error.message);
        }
    }
}

module.exports = SlackAdapter;
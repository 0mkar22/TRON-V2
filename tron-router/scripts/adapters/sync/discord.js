// tron-router/scripts/adapters/sync/discord.js
const axios = require('axios');

/**
 * 📢 T.R.O.N. Discord Adapter
 * Handles both syncing channels for configuration and broadcasting AI summaries.
 */
class DiscordAdapter {
    
    // ==========================================
    // 1. SYNC FUNCTION (Used by enterprise-sync.js)
    // ==========================================
    static async fetchChannels(botToken) {
        let allChannels = [];
        const headers = { 'Authorization': `Bot ${botToken}` };

        console.log(`[DISCORD SYNC] Fetching Discord Guilds (Servers)...`);

        try {
            // 1. Fetch every server the Bot is installed in
            const guildsRes = await axios.get('https://discord.com/api/v10/users/@me/guilds', { headers });

            for (const guild of guildsRes.data) {
                try {
                    // 2. Fetch every channel inside that server
                    const channelsRes = await axios.get(`https://discord.com/api/v10/guilds/${guild.id}/channels`, { headers });

                    // 🛡️ LOOPHOLE CLOSED: Strict filter for Text Channels (type === 0)
                    const textChannels = channelsRes.data.filter(c => c.type === 0);

                    const mapped = textChannels.map(c => ({
                        tool: "discord",
                        id: c.id,
                        name: c.name,
                        webhook: c.id // The runtime Messenger will use this Channel ID to POST the message
                    }));

                    allChannels = allChannels.concat(mapped);
                } catch (channelErr) {
                    console.error(`❌ [DISCORD SYNC] Failed to fetch channels for server ${guild.name}:`, channelErr.message);
                    continue; // Skip the broken server but keep syncing the rest
                }
            }
        } catch (error) {
            console.error(`❌ [DISCORD SYNC] Fatal API Error:`, error.message);
        }

        console.log(`✅ [DISCORD SYNC] Successfully mapped ${allChannels.length} text channels.`);
        return allChannels;
    }

    // ==========================================
    // 2. BROADCAST FUNCTION (Used by messenger.js)
    // ==========================================
    static async sendToDiscord(webhookUrl, title, description, url, colorHex, aiResult) {
        console.log(`🤖 [DISCORD ADAPTER] Formatting rich embed...`);

        // 🎨 DISCORD EMBED CONSTRUCTION
        const discordPayload = {
            embeds: [{
                title: `🚀 T.R.O.N. Intel: ${title}`,
                url: url,
                color: 3447003, // Enterprise Blue
                fields: [
                    { name: "🎯 Intent", value: aiResult?.intent || "N/A", inline: true },
                    { name: "🛡️ AI Confidence", value: `${aiResult?.confidence_score || 0}/100`, inline: true },
                    { name: "💼 Business Impact", value: aiResult?.business_impact || "N/A" },
                    { name: "📝 Executive Summary", value: aiResult?.executive_summary || "N/A" }
                ],
                footer: { text: "T.R.O.N. Local Watcher • AI Pipeline" },
                timestamp: new Date()
            }]
        };

        try {
            const isDiscordChannelId = /^\d+$/.test(webhookUrl);

            if (isDiscordChannelId) {
                console.log(`🤖 [DISCORD] Using Discord Bot API for Channel ID: ${webhookUrl}`);
                await axios.post(`https://discord.com/api/v10/channels/${webhookUrl}/messages`, discordPayload, {
                    headers: {
                        'Authorization': `Bot ${process.env.DISCORD_BOT_TOKEN}`,
                        'Content-Type': 'application/json'
                    }
                });
            } else {
                console.log(`🔗 [DISCORD] Using standard Webhook URL.`);
                await axios.post(webhookUrl, discordPayload);
            }

            console.log(`✅ [DISCORD ADAPTER] Successfully broadcasted to the team!`);

        } catch (error) {
            console.error(`❌ [DISCORD ADAPTER] Failed to broadcast:`, error.message);
            if (error.response) {
                console.error("Discord Error Details:", JSON.stringify(error.response.data));
            }
        }
    }
}

// Export the class so both sync scripts and the messenger can use it
module.exports = DiscordAdapter;
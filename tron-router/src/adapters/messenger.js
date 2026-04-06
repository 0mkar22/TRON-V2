const axios = require('axios');

/**
 * 📢 T.R.O.N. Messenger Adapter
 * Updated to handle the full PR context and AI report.
 */
async function broadcastSummary(webhookUrl, prTitle, prUrl, aiResult) {
    console.log(`\n📢 [MESSENGER ADAPTER] Formatting and broadcasting to team channel...`);

    // 🛡️ DATA INTEGRITY CHECK
    // If aiResult is missing, we provide fallbacks so the message doesn't break.
    const intent = aiResult?.intent || "General Update";
    const impact = aiResult?.business_impact || "Manual review required.";
    const summary = aiResult?.executive_summary || "No automated summary available.";
    const confidence = aiResult?.confidence_score || 0;

    // 🎨 DISCORD EMBED CONSTRUCTION
    // Using embeds makes the message look like a professional enterprise notification.
    const discordPayload = {
        embeds: [{
            title: `🚀 T.R.O.N. Intel: ${prTitle}`,
            url: prUrl,
            color: 3447003, // A nice "Enterprise Blue"
            fields: [
                { name: "🎯 Intent", value: intent, inline: true },
                { name: "🛡️ AI Confidence", value: `${confidence}/100`, inline: true },
                { name: "💼 Business Impact", value: impact },
                { name: "📝 Executive Summary", value: summary }
            ],
            footer: { text: "T.R.O.N. Local Watcher • AI Pipeline" },
            timestamp: new Date()
        }]
    };

    try {
        const isDiscordChannelId = /^\d+$/.test(webhookUrl);

        if (isDiscordChannelId) {
            console.log(`🤖 [MESSENGER] Using Discord Bot API for Channel ID: ${webhookUrl}`);
            await axios.post(`https://discord.com/api/v10/channels/${webhookUrl}/messages`, discordPayload, {
                headers: {
                    'Authorization': `Bot ${process.env.DISCORD_BOT_TOKEN}`,
                    'Content-Type': 'application/json'
                }
            });
        } else {
            console.log(`🔗 [MESSENGER] Using standard Webhook URL.`);
            await axios.post(webhookUrl, discordPayload);
        }

        console.log(`✅ [MESSENGER ADAPTER] Successfully broadcasted to the team!`);

    } catch (error) {
        console.error(`❌ [MESSENGER ADAPTER] Failed to broadcast:`, error.message);
        if (error.response) {
            console.error("Messenger Error Details:", JSON.stringify(error.response.data));
        }
    }
}

module.exports = { broadcastSummary };
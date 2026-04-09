// tron-router/src/adapters/messenger.js
const DiscordAdapter = require('../../scripts/adapters/sync/discord');
const SlackAdapter = require('../../scripts/adapters/sync/slack');
const TeamsAdapter = require('../../scripts/adapters/sync/teams');

/**
 * 📢 T.R.O.N. Messenger Orchestrator
 * Routes the AI report to the correct communication platform based on tron.yaml.
 */
async function broadcastSummary(communicationConfig, prTitle, prUrl, aiResult) {
    console.log(`\n📢 [MESSENGER ORCHESTRATOR] Routing broadcast to team channel...`);

    // 🛡️ DATA INTEGRITY CHECK
    const intent = aiResult?.intent || "General Update";
    const impact = aiResult?.business_impact || "Manual review required.";
    const summary = aiResult?.executive_summary || "No automated summary available.";
    const confidence = aiResult?.confidence_score || 0;

    // 🎨 FORMAT UNIVERSAL DESCRIPTION
    // We combine the AI data into a clean Markdown string that Slack & Teams can easily render.
    const description = `**🎯 Intent:** ${intent}\n**🛡️ AI Confidence:** ${confidence}/100\n**💼 Business Impact:** ${impact}\n\n**📝 Executive Summary:**\n${summary}`;
    const colorHex = "#3447003"; // Enterprise Blue

    // 🔀 DYNAMIC ROUTING
    // Extract provider and webhook info (with fallbacks for older configs)
    const provider = communicationConfig?.provider || 'discord';
    const webhookUrl = communicationConfig?.webhook_url || communicationConfig; 

    if (!webhookUrl) {
        console.error("❌ [MESSENGER] No webhook URL configured for this project.");
        return;
    }

    try {
        if (provider === 'discord') {
            await DiscordAdapter.sendToDiscord(webhookUrl, prTitle, description, prUrl, colorHex, aiResult);
        } else if (provider === 'slack') {
            await SlackAdapter.sendToSlack(webhookUrl, prTitle, description, prUrl, colorHex);
        } else if (provider === 'teams') {
            await TeamsAdapter.sendToTeams(webhookUrl, prTitle, description, prUrl, colorHex);
        } else {
            console.warn(`⚠️ [MESSENGER] Unknown communication provider: ${provider}`);
        }
    } catch (error) {
        console.error(`❌ [MESSENGER] Broadcast failed for provider [${provider}]:`, error.message);
    }
}

module.exports = { broadcastSummary };
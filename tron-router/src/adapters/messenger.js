const axios = require('axios');

// ==========================================
// THE CORPORATE MEGAPHONE
// ==========================================
async function broadcastSummary(webhookUrl, prTitle, prUrl, aiReport) {
    if (!webhookUrl || webhookUrl === 'YOUR_WEBHOOK_URL_HERE') {
        console.log(`⏭️  [MESSENGER ADAPTER] No webhook URL configured. Skipping broadcast.`);
        return;
    }

    console.log(`\n📢 [MESSENGER ADAPTER] Broadcasting Executive Summary to team channel...`);

    // Determine the color based on the AI's intent
    let statusEmoji = "✨";
    if (aiReport.intent.includes("Bug")) statusEmoji = "🐛";
    if (aiReport.intent.includes("Refactor")) statusEmoji = "♻️";
    if (aiReport.intent.includes("Infrastructure")) statusEmoji = "🏗️";

    // Format a universal Markdown payload that works on Slack, Teams, and Discord
    const formattedMessage = `
**${statusEmoji} T.R.O.N. Executive Summary: ${prTitle}**
*${aiReport.intent}*

**📝 Summary:**
${aiReport.executive_summary}

**🚀 Business Impact:**
${aiReport.business_impact}

**🎯 AI Confidence:** ${aiReport.confidence_score}/100
🔗 [View Pull Request](${prUrl})
    `.trim();

    try {
        // Discord uses {"content": "text"}, Slack/Teams use {"text": "text"}
        // Sending both keys simultaneously ensures it works universally across all 3 platforms!
        const payload = {
            text: formattedMessage,
            content: formattedMessage 
        };

        await axios.post(webhookUrl, payload, {
            headers: { 'Content-Type': 'application/json' }
        });

        console.log(`✅ [MESSENGER ADAPTER] Successfully broadcasted to the team!`);

    } catch (error) {
        console.error(`❌ [MESSENGER ADAPTER] Failed to broadcast message:`, error.message);
    }
}

module.exports = { broadcastSummary };
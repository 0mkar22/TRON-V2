const axios = require('axios');

class DiscordAdapter {
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

                    // 🛡️ LOOPHOLE CLOSED: Discord returns Voice, Stage, and Category channels. 
                    // We must strictly filter for Text Channels (type === 0) so we don't try to send text to a Voice channel!
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
}

module.exports = DiscordAdapter;
const axios = require('axios');

const BASECAMP_ACCOUNT_ID = process.env.BASECAMP_ACCOUNT_ID;
const BASECAMP_ACCESS_TOKEN = process.env.BASECAMP_ACCESS_TOKEN;

const basecampAPI = axios.create({
    baseURL: `https://3.basecampapi.com/${BASECAMP_ACCOUNT_ID}`,
    headers: {
        'Authorization': `Bearer ${BASECAMP_ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
        'User-Agent': 'T.R.O.N. Integration (your-email@example.com)' 
    }
});

async function updateTicketStatus(taskID, newStatus, boardID) {
    console.log(`\n🏕️  [BASECAMP ADAPTER] Connecting to Basecamp Project: ${boardID}`);
    console.log(`🏕️  [BASECAMP ADAPTER] Attempting to move [${taskID}] to column: "${newStatus}"`);

    if (!BASECAMP_ACCESS_TOKEN || !BASECAMP_ACCOUNT_ID || BASECAMP_ACCOUNT_ID.includes('here')) {
        console.warn(`⚠️  [BASECAMP ADAPTER] Missing Basecamp credentials in .env! Simulation mode active.`);
        return true; 
    }

    try {
        const response = await basecampAPI.put(`/buckets/${boardID}/todos/${taskID}.json`, {
            completed: newStatus.toLowerCase() === 'done' || newStatus.toLowerCase() === 'completed'
        });

        console.log(`🏕️  [BASECAMP ADAPTER] ✅ Basecamp API responded with Status: ${response.status}`);
        return true;
    } catch (error) {
        console.error(`❌ [BASECAMP ADAPTER] Failed to update Basecamp.`);
        if (error.response) {
            console.error(`Basecamp Error Data:`, error.response.data);
            console.error(`Basecamp Error Status:`, error.response.status);
        } else {
            console.error(error.message);
        }
        throw error;
    }
}

module.exports = { updateTicketStatus };
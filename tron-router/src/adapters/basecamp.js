const axios = require('axios');

const BASECAMP_ACCOUNT_ID = process.env.BASECAMP_ACCOUNT_ID;
let BASECAMP_ACCESS_TOKEN = process.env.BASECAMP_ACCESS_TOKEN; // Changed to 'let' so we can update it in memory!

// NEW: Credentials for refreshing
const REFRESH_TOKEN = process.env.BASECAMP_REFRESH_TOKEN;
const CLIENT_ID = process.env.BASECAMP_CLIENT_ID;
const CLIENT_SECRET = process.env.BASECAMP_CLIENT_SECRET;

const basecampAPI = axios.create({
    baseURL: `https://3.basecampapi.com/${BASECAMP_ACCOUNT_ID}`,
    headers: {
        'Authorization': `Bearer ${BASECAMP_ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
        'User-Agent': 'T.R.O.N. Integration (your-email@example.com)' 
    }
});

// ==========================================
// THE OAUTH 2.0 REFRESH ENGINE
// ==========================================
async function refreshAccessToken() {
    console.log('🔄 [BASECAMP ADAPTER] Access token expired. Attempting to refresh...');
    try {
        const response = await axios.post('https://launchpad.37signals.com/authorization/token', null, {
            params: {
                type: 'refresh',
                refresh_token: REFRESH_TOKEN,
                client_id: CLIENT_ID,
                client_secret: CLIENT_SECRET,
            }
        });

        const newAccessToken = response.data.access_token;
        console.log('✅ [BASECAMP ADAPTER] Successfully acquired new Access Token!');
        return newAccessToken;
    } catch (error) {
        console.error('❌ [BASECAMP ADAPTER] CRITICAL: Failed to refresh token. Is the Refresh Token revoked?');
        throw error;
    }
}

// ==========================================
// AXIOS INTERCEPTOR (The Safety Net)
// ==========================================
basecampAPI.interceptors.response.use(
    (response) => {
        // If the request succeeds, just return the response normally
        return response;
    },
    async (error) => {
        const originalRequest = error.config;

        // If Basecamp returns 401 (Unauthorized) AND we haven't already tried to retry this exact request...
        if (error.response && error.response.status === 401 && !originalRequest._retry) {
            originalRequest._retry = true; // Mark it so we don't get stuck in an infinite loop

            try {
                // 1. Get the new token
                const newToken = await refreshAccessToken();
                
                // 2. Update it in memory for future requests
                BASECAMP_ACCESS_TOKEN = newToken;
                basecampAPI.defaults.headers['Authorization'] = `Bearer ${newToken}`;
                
                // 3. Update the dead token on the stalled request
                originalRequest.headers['Authorization'] = `Bearer ${newToken}`;
                
                // 4. Replay the original request seamlessly!
                return basecampAPI(originalRequest);
            } catch (refreshError) {
                // If the refresh itself fails, we are completely locked out.
                return Promise.reject(refreshError);
            }
        }

        // If it's a different error (like a 404), just pass it down the chain
        return Promise.reject(error);
    }
);

// ==========================================
// THE CORE LOGIC (KANBAN CARD TABLE)
// ==========================================
async function updateTicketStatus(taskID, newStatus, boardID) {
    // 1. Basecamp APIs require pure numbers. We must strip "TASK-" from "TASK-123456"
    const pureCardID = taskID.replace(/\D/g, ''); 
    const destinationColumnID = parseInt(newStatus); // From our tron.yaml

    console.log(`\n🏕️  [BASECAMP ADAPTER] Connecting to Basecamp Project: ${boardID}`);
    console.log(`🏕️  [BASECAMP ADAPTER] Moving Card [${pureCardID}] to Column ID: [${destinationColumnID}]`);

    if (!BASECAMP_ACCESS_TOKEN || BASECAMP_ACCOUNT_ID.includes('here')) {
        console.warn(`⚠️  [BASECAMP ADAPTER] Missing Basecamp credentials in .env! Simulation mode active.`);
        return true; 
    }

    try {
        // 2. The Basecamp Card Table "Move" Endpoint
        const response = await basecampAPI.post(`/buckets/${boardID}/card_tables/cards/${pureCardID}/moves.json`, {
            column_id: destinationColumnID 
        });

        console.log(`🏕️  [BASECAMP ADAPTER] ✅ Successfully moved card! Basecamp API Status: ${response.status}`);
        return true;

    } catch (error) {
        console.error(`❌ [BASECAMP ADAPTER] Failed to update Basecamp.`);
        if (error.response) {
            console.error(`Basecamp Error Status:`, error.response.status);
            console.error(`Basecamp Error Data:`, JSON.stringify(error.response.data, null, 2));
        }
        throw error;
    }
}

module.exports = { updateTicketStatus };
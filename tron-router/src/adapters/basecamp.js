const axios = require('axios');
const Redis = require('ioredis');

const redis = new Redis(process.env.REDIS_URL);

const BASECAMP_ACCOUNT_ID = process.env.BASECAMP_ACCOUNT_ID;
// We will load the initial token from .env, but overwrite it dynamically later
let BASECAMP_ACCESS_TOKEN = process.env.BASECAMP_ACCESS_TOKEN;

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
// THE OAUTH 2.0 REFRESH ENGINE (THREAD-SAFE)
// ==========================================
async function refreshAccessToken() {
    const lockKey = 'tron:basecamp_refresh_lock';
    
    // 🛡️ ARCHITECTURE FIX: Attempt to acquire a 10-second distributed lock
    const acquiredLock = await redis.set(lockKey, 'LOCKED', 'NX', 'EX', 10);

    if (!acquiredLock) {
        console.log('⏳ [BASECAMP ADAPTER] Another worker is currently refreshing the token. Waiting 2 seconds...');
        // Wait for the other thread to finish, then pull its new token from the vault
        await new Promise(resolve => setTimeout(resolve, 2000));
        const vaultToken = await redis.get('tron:basecamp_access_token');
        if (!vaultToken) throw new Error("Token refresh race condition timeout.");
        return vaultToken;
    }

    console.log('🔄 [BASECAMP ADAPTER] Lock acquired. Refreshing Basecamp token...');
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

        await redis.set('tron:basecamp_access_token', newAccessToken);
        console.log('✅ [BASECAMP ADAPTER] Successfully acquired and saved new Access Token to Redis!');

        return newAccessToken;
    } catch (error) {
        console.error('❌ [BASECAMP ADAPTER] CRITICAL: Failed to refresh token.');
        throw error;
    } finally {
        // Always release the lock so the system doesn't freeze
        await redis.del(lockKey);
    }
}

// ==========================================
// AXIOS INTERCEPTOR (The Safety Net)
// ==========================================
basecampAPI.interceptors.response.use(
    (response) => {
        return response;
    },
    async (error) => {
        const originalRequest = error.config;

        if (error.response && error.response.status === 401 && !originalRequest._retry) {
            originalRequest._retry = true;

            try {
                const newToken = await refreshAccessToken();

                BASECAMP_ACCESS_TOKEN = newToken;
                basecampAPI.defaults.headers['Authorization'] = `Bearer ${newToken}`;
                originalRequest.headers['Authorization'] = `Bearer ${newToken}`;

                return basecampAPI(originalRequest);
            } catch (refreshError) {
                return Promise.reject(refreshError);
            }
        }
        return Promise.reject(error);
    }
);

// ==========================================
// AUTO-RESOLVE ENGINE (SEARCH & CREATE)
// ==========================================
async function resolveTask(taskInput, boardID, todoColumnID) {
    console.log(`\n🔍 [BASECAMP ADAPTER] Resolving Task: "${taskInput}"`);

    // 🛡️ QoL UPGRADE: Always check the Redis Vault for the latest token before a request
    const vaultToken = await redis.get('tron:basecamp_access_token');
    if (vaultToken) {
        BASECAMP_ACCESS_TOKEN = vaultToken;
        basecampAPI.defaults.headers['Authorization'] = `Bearer ${vaultToken}`;
    }

    if (!BASECAMP_ACCESS_TOKEN || BASECAMP_ACCOUNT_ID.includes('here')) {
        console.warn(`⚠️  [BASECAMP ADAPTER] Simulation Mode. Generating fake ID.`);
        return `SIM-${Math.floor(Math.random() * 10000)}`;
    }

    try {
        const rawIdMatch = taskInput.match(/\d{8,}/);
        if (rawIdMatch) {
            console.log(`✅ [BASECAMP ADAPTER] Detected raw ID input. Bypassing search.`);
            return rawIdMatch[0];
        }

        const listResponse = await basecampAPI.get(`/buckets/${boardID}/card_tables/lists/${todoColumnID}/cards.json`);
        const existingCards = listResponse.data;

        const foundCard = existingCards.find(card => card.title.toLowerCase().includes(taskInput.toLowerCase()));

        if (foundCard) {
            console.log(`✅ [BASECAMP ADAPTER] Found existing card! ID: ${foundCard.id}`);
            return foundCard.id.toString();
        }

        console.log(`✨ [BASECAMP ADAPTER] Card not found. Auto-creating new ticket: "${taskInput}"`);
        const createResponse = await basecampAPI.post(`/buckets/${boardID}/card_tables/lists/${todoColumnID}/cards.json`, {
            title: taskInput
        });

        console.log(`✅ [BASECAMP ADAPTER] Successfully created new card! ID: ${createResponse.data.id}`);
        return createResponse.data.id.toString();

    } catch (error) {
        console.error(`❌ [BASECAMP ADAPTER] Resolve Engine Failed.`);
        throw error;
    }
}

// ==========================================
// THE CORE LOGIC (KANBAN CARD TABLE)
// ==========================================
async function updateTicketStatus(taskID, newStatus, boardID) {
    const pureCardID = taskID.replace(/\D/g, '');
    const destinationColumnID = parseInt(newStatus);

    console.log(`\n🏕️  [BASECAMP ADAPTER] Connecting to Basecamp Project: ${boardID}`);
    console.log(`🏕️  [BASECAMP ADAPTER] Moving Card [${pureCardID}] to Column ID: [${destinationColumnID}]`);

    // 🛡️ QoL UPGRADE: Always check the Redis Vault for the latest token before a request
    const vaultToken = await redis.get('tron:basecamp_access_token');
    if (vaultToken) {
        BASECAMP_ACCESS_TOKEN = vaultToken;
        basecampAPI.defaults.headers['Authorization'] = `Bearer ${vaultToken}`;
    }

    if (!BASECAMP_ACCESS_TOKEN || BASECAMP_ACCOUNT_ID.includes('here')) {
        console.warn(`⚠️  [BASECAMP ADAPTER] Missing Basecamp credentials in .env! Simulation mode active.`);
        return true;
    }

    try {
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

// THE SINGLE, DEFINITIVE EXPORT
module.exports = { updateTicketStatus, resolveTask };
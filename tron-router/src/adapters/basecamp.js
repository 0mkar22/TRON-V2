const axios = require('axios');
const Redis = require('ioredis');

const redis = new Redis(process.env.REDIS_URL);
const BASECAMP_ACCOUNT_ID = process.env.BASECAMP_ACCOUNT_ID;
let BASECAMP_ACCESS_TOKEN = process.env.BASECAMP_ACCESS_TOKEN;
const REFRESH_TOKEN = process.env.BASECAMP_REFRESH_TOKEN;
const CLIENT_ID = process.env.BASECAMP_CLIENT_ID;
const CLIENT_SECRET = process.env.BASECAMP_CLIENT_SECRET;

const basecampAPI = axios.create({
    baseURL: `https://3.basecampapi.com/${BASECAMP_ACCOUNT_ID}`,
    headers: {
        'Authorization': `Bearer ${BASECAMP_ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json', // 🛡️ Bypasses Basecamp 406 Errors
        'User-Agent': 'T.R.O.N. Integration (admin@tron.local)'
    }
});

async function syncToken() {
    const vaultToken = await redis.get('tron:basecamp_access_token');
    if (vaultToken) {
        BASECAMP_ACCESS_TOKEN = vaultToken;
        basecampAPI.defaults.headers['Authorization'] = `Bearer ${vaultToken}`;
    }
}

async function refreshAccessToken() {
    const lockKey = 'tron:basecamp_refresh_lock';
    const acquiredLock = await redis.set(lockKey, 'LOCKED', 'NX', 'EX', 10);
    if (!acquiredLock) {
        await new Promise(resolve => setTimeout(resolve, 2000));
        return await redis.get('tron:basecamp_access_token');
    }
    try {
        const response = await axios.post('https://launchpad.37signals.com/authorization/token', null, {
            params: { type: 'refresh', refresh_token: REFRESH_TOKEN, client_id: CLIENT_ID, client_secret: CLIENT_SECRET }
        });
        await redis.set('tron:basecamp_access_token', response.data.access_token);
        return response.data.access_token;
    } finally {
        await redis.del(lockKey);
    }
}

basecampAPI.interceptors.response.use((response) => response, async (error) => {
    const originalRequest = error.config;
    if (error.response && error.response.status === 401 && !originalRequest._retry) {
        originalRequest._retry = true;
        const newToken = await refreshAccessToken();
        BASECAMP_ACCESS_TOKEN = newToken;
        basecampAPI.defaults.headers['Authorization'] = `Bearer ${newToken}`;
        originalRequest.headers['Authorization'] = `Bearer ${newToken}`;
        return basecampAPI(originalRequest);
    }
    return Promise.reject(error);
});

// ==========================================
// 1. READ: FETCH TICKETS USING COLUMN ID
// ==========================================
async function fetchActiveTasks(boardID, todoColumnID) {
    console.log(`\n📋 [BASECAMP ADAPTER] Fetching open tickets from Column: ${todoColumnID}`);
    await syncToken();
    try {
        const response = await basecampAPI.get(`/buckets/${boardID}/card_tables/lists/${todoColumnID}/cards.json`);
        return response.data.map(card => ({ id: card.id.toString(), title: card.title }));
    } catch (error) {
        console.error(`❌ [BASECAMP ADAPTER] Failed to fetch tickets:`, error.message);
        return [];
    }
}

// ==========================================
// 2. WRITE: MOVE TICKET USING COLUMN ID
// ==========================================
async function updateTicketStatus(taskID, newStatusID, boardID) {
    const pureCardID = taskID.replace(/\D/g, '');
    console.log(`[BASECAMP ADAPTER] Moving ticket ${pureCardID} to column ID: ${newStatusID}`);
    await syncToken();
    try {
        await basecampAPI.post(`/buckets/${boardID}/card_tables/cards/${pureCardID}/moves.json`, {
            column_id: parseInt(newStatusID)
        });
        console.log(`🏕️  [BASECAMP ADAPTER] ✅ Successfully moved card`);
        return true;
    } catch (error) {
        console.error(`❌ [BASECAMP ADAPTER] Failed to update ticket status:`, error.message);
        throw error;
    }
}

// ==========================================
// 3. CREATE: NEW TASK IN COLUMN
// ==========================================
async function createTask(boardID, todoColumnID, taskName) {
    console.log(`✨ [BASECAMP ADAPTER] Auto-creating new ticket: "${taskName}"`);
    await syncToken();
    try {
        const createResponse = await basecampAPI.post(`/buckets/${boardID}/card_tables/lists/${todoColumnID}/cards.json`, {
            title: taskName
        });
        return createResponse.data.id.toString();
    } catch (error) {
        console.error(`❌ [BASECAMP ADAPTER] Failed to create task:`, error.message);
        return taskName.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase();
    }
}

module.exports = { fetchActiveTasks, updateTicketStatus, createTask };
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
        'User-Agent': 'T.R.O.N. Integration (admin@tron.local)'
    }
});

/**
 * 🛡️ HELPER: Sync local token with Redis Vault before any API call
 */
async function syncToken() {
    const vaultToken = await redis.get('tron:basecamp_access_token');
    if (vaultToken) {
        BASECAMP_ACCESS_TOKEN = vaultToken;
        basecampAPI.defaults.headers['Authorization'] = `Bearer ${vaultToken}`;
    }
}

// ==========================================
// THE OAUTH 2.0 REFRESH ENGINE (THREAD-SAFE)
// ==========================================
async function refreshAccessToken() {
    const lockKey = 'tron:basecamp_refresh_lock';
    const acquiredLock = await redis.set(lockKey, 'LOCKED', 'NX', 'EX', 10);

    if (!acquiredLock) {
        console.log('⏳ [BASECAMP ADAPTER] Another worker is currently refreshing the token. Waiting 2 seconds...');
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
        await redis.del(lockKey);
    }
}

// ==========================================
// AXIOS INTERCEPTOR (The Safety Net)
// ==========================================
basecampAPI.interceptors.response.use(
    (response) => response,
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
// 🔍 HELPER: DYNAMIC COLUMN DISCOVERY
// ==========================================
async function getProjectColumns(boardID) {
    await syncToken();
    // 1. Get the Card Table ID for the project (Basecamp usually has 1 per project)
    const tablesRes = await basecampAPI.get(`/buckets/${boardID}/card_tables.json`);
    if (tablesRes.data.length === 0) throw new Error("No Card Table found in this Basecamp project.");
    
    const cardTableId = tablesRes.data[0].id;

    // 2. Fetch the actual lists (columns) inside that Card Table
    const listsRes = await basecampAPI.get(`/buckets/${boardID}/card_tables/${cardTableId}/lists.json`);
    return listsRes.data;
}

// ==========================================
// 1. READ: FETCH TICKETS FOR GO DAEMON MENU
// ==========================================
async function fetchActiveTasks(boardID) {
    console.log(`\n📋 [BASECAMP ADAPTER] Fetching open tickets for Project: ${boardID}`);
    try {
        const columns = await getProjectColumns(boardID);
        // Look for a column named "To Do" or fallback to the first column
        const todoCol = columns.find(c => c.name.toLowerCase().includes('to do') || c.name.toLowerCase().includes('todo')) || columns[0];

        const response = await basecampAPI.get(`/buckets/${boardID}/card_tables/lists/${todoCol.id}/cards.json`);
        
        return response.data.map(card => ({
            id: card.id.toString(),
            title: card.title
        }));
    } catch (error) {
        console.error(`❌ [BASECAMP ADAPTER] Failed to fetch tickets:`, error.message);
        return [];
    }
}

// ==========================================
// 2. WRITE: MOVE TICKET STATUS
// ==========================================
async function updateTicketStatus(taskID, newStatusText, boardID) {
    console.log(`[BASECAMP ADAPTER] Locating column ID for status: "${newStatusText}"...`);
    const pureCardID = taskID.replace(/\D/g, '');

    try {
        const columns = await getProjectColumns(boardID);
        const targetColumn = columns.find(col => col.name.toLowerCase() === newStatusText.toLowerCase());

        if (!targetColumn) {
            console.warn(`⚠️ [BASECAMP ADAPTER] Status "${newStatusText}" not found. Available: ${columns.map(c=>c.name).join(', ')}`);
            return false;
        }

        console.log(`[BASECAMP ADAPTER] Moving ticket ${pureCardID} to column ID: ${targetColumn.id}`);
        await basecampAPI.post(`/buckets/${boardID}/card_tables/cards/${pureCardID}/moves.json`, {
            column_id: targetColumn.id
        });

        console.log(`🏕️  [BASECAMP ADAPTER] ✅ Successfully moved card to "${newStatusText}"`);
        return true;
    } catch (error) {
        console.error(`❌ [BASECAMP ADAPTER] Failed to update ticket status:`, error.response?.data || error.message);
        throw error;
    }
}

// ==========================================
// 3. CREATE: AUTO-RESOLVE ENGINE
// ==========================================
async function createTask(boardID, taskName) {
    console.log(`✨ [BASECAMP ADAPTER] Auto-creating new ticket: "${taskName}"`);
    try {
        const columns = await getProjectColumns(boardID);
        const todoCol = columns.find(c => c.name.toLowerCase().includes('to do') || c.name.toLowerCase().includes('todo')) || columns[0];

        const createResponse = await basecampAPI.post(`/buckets/${boardID}/card_tables/lists/${todoCol.id}/cards.json`, {
            title: taskName
        });

        return createResponse.data.id.toString();
    } catch (error) {
        console.error(`❌ [BASECAMP ADAPTER] Failed to create task:`, error.message);
        // Safe fallback for the daemon to still create a branch
        return taskName.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase();
    }
}

module.exports = { 
    fetchActiveTasks,
    updateTicketStatus, 
    createTask
};
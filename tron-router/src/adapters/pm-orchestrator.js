const BasecampAdapter = require('./basecamp');
const JiraAdapter = require('./jira');
const MondayAdapter = require('./monday');

class PMOrchestrator {
    
    // 🛡️ Added 'mapping' as the second parameter
    static async getTickets(pmConfig, mapping) {
        const provider = pmConfig.provider || 'basecamp';
        if (provider === 'basecamp') {
            // Passing BOTH the board ID and the To-Do Column ID
            return await BasecampAdapter.fetchActiveTasks(pmConfig.board_id, mapping.todo_column);
        } else if (provider === 'jira') {
            return await JiraAdapter.fetchActiveTasks(pmConfig.project_key);
        } else if (provider === 'monday') { 
            return await MondayAdapter.fetchActiveTasks(pmConfig.board_id);
        }
        return [];
    }

    static async updateTicketStatus(pmConfig, ticketId, newStatusID) {
        const provider = pmConfig.provider || 'basecamp';
        if (provider === 'basecamp') {
            await BasecampAdapter.updateTicketStatus(ticketId, newStatusID, pmConfig.board_id); 
        } else if (provider === 'jira') {
            await JiraAdapter.updateTicketStatus(ticketId, newStatusID);
        } else if (provider === 'monday') { 
            await MondayAdapter.updateTicketStatus(ticketId, newStatusID, pmConfig.board_id);
        }
    }

    // 🛡️ Added 'mapping' as the third parameter
    static async createTicket(pmConfig, taskName, mapping) {
        const provider = pmConfig.provider || 'basecamp';
        if (provider === 'basecamp') {
            return await BasecampAdapter.createTask(pmConfig.board_id, mapping.todo_column, taskName);
        } else if (provider === 'jira' || provider === 'monday') {
            return taskName.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase();
        }
        return taskName.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase();
    }
}

module.exports = PMOrchestrator;
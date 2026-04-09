// tron-router/src/adapters/pm-orchestrator.js
const BasecampAdapter = require('./basecamp');
const JiraAdapter = require('./jira');
const MondayAdapter = require('./monday');

class PMOrchestrator {
    
    /**
     * Routes the fetch request to the correct PM tool based on tron.yaml
     */
    static async getTickets(pmConfig) {
        const provider = pmConfig.provider || 'basecamp';

        if (provider === 'basecamp') {
            return await BasecampAdapter.fetchActiveTasks(pmConfig.board_id);
        } else if (provider === 'jira') {
            return await JiraAdapter.fetchActiveTasks(pmConfig.project_key);
        } else if (provider === 'monday') { 
            return await MondayAdapter.fetchActiveTasks(pmConfig.board_id);
        } else {
            console.warn(`⚠️ [PM ORCHESTRATOR] Unknown PM provider: ${provider}`);
            return [];
        }
    }

    /**
     * Routes the status update request when a PR is opened/merged or branch is created
     */
    static async updateTicketStatus(pmConfig, ticketId, newStatus) {
        const provider = pmConfig.provider || 'basecamp';

        if (provider === 'basecamp') {
            await BasecampAdapter.updateTicketStatus(ticketId, newStatus, pmConfig.board_id); 
        } else if (provider === 'jira') {
            await JiraAdapter.updateTicketStatus(ticketId, newStatus);
        } else if (provider === 'monday') { 
            await MondayAdapter.updateTicketStatus(ticketId, newStatus, pmConfig.board_id);
        }
    }

    /**
     * Creates a brand new ticket when a developer types a custom name in the Daemon
     */
    static async createTicket(pmConfig, taskName) {
        const provider = pmConfig.provider || 'basecamp';

        if (provider === 'basecamp') {
            return await BasecampAdapter.createTask(pmConfig.board_id, taskName);
        } else if (provider === 'jira') {
            console.log(`⚠️ Jira auto-creation not yet implemented. Returning sanitized branch name.`);
            return taskName.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase();
        } else if (provider === 'monday') {
            console.log(`⚠️ Monday auto-creation not yet implemented. Returning sanitized branch name.`);
            return taskName.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase();
        }
        
        // Fallback for missing configs or "none"
        return taskName.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase();
    }
}

module.exports = PMOrchestrator;
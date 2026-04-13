// src/adapters/pm-orchestrator.js
const BasecampAdapter = require('./basecamp');
const JiraAdapter = require('./jira');
const MondayAdapter = require('./monday');

class PMOrchestrator {
    
    static async getTickets(pmConfig = {}, mapping = {}) {
        const provider = pmConfig.provider || 'none';
        
        try {
            if (provider === 'basecamp') {
                // Fetch from BOTH To Do and In Progress columns
                const todoTasks = mapping.todo_column 
                    ? await BasecampAdapter.fetchActiveTasks(pmConfig.board_id, mapping.todo_column) 
                    : [];
                const inProgressTasks = mapping.branch_created 
                    ? await BasecampAdapter.fetchActiveTasks(pmConfig.board_id, mapping.branch_created) 
                    : [];
                
                // Add a state label so the VS Code UI knows where they are
                return [
                    ...todoTasks.map(t => ({ ...t, state: 'To Do' })),
                    ...inProgressTasks.map(t => ({ ...t, state: 'In Progress' }))
                ];
            } else if (provider === 'jira') {
                return await JiraAdapter.fetchActiveTasks(pmConfig.project_key);
            } else if (provider === 'monday') { 
                return await MondayAdapter.fetchActiveTasks(pmConfig.board_id);
            }
        } catch (error) {
            console.error(`❌ [ORCHESTRATOR] Failed to fetch tickets for ${provider}:`, error.message);
        }
        return [];
    }

    static async updateTicketStatus(pmConfig = {}, ticketId, newStatusID) {
        const provider = pmConfig.provider || 'none';
        
        if (!newStatusID) {
            console.log(`⏭️ [ORCHESTRATOR] Skipping update: No destination column ID provided.`);
            return;
        }

        try {
            if (provider === 'basecamp') {
                await BasecampAdapter.updateTicketStatus(ticketId, newStatusID, pmConfig.board_id); 
            } else if (provider === 'jira') {
                await JiraAdapter.updateTicketStatus(ticketId, newStatusID);
            } else if (provider === 'monday') { 
                await MondayAdapter.updateTicketStatus(ticketId, newStatusID, pmConfig.board_id);
            }
        } catch (error) {
            console.error(`❌ [ORCHESTRATOR] Failed to update status for ${provider}:`, error.message);
        }
    }

    static async resolveTask(pmConfig = {}, taskName, mapping = {}) {
        const provider = pmConfig.provider || 'none';
        const fallbackId = taskName.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase();

        try {
            if (provider === 'basecamp') {
                return await BasecampAdapter.resolveTask(pmConfig.board_id, mapping.todo_column, taskName);
            } else if (provider === 'jira' || provider === 'monday') {
                return fallbackId; // Add Jira/Monday resolution later
            }
        } catch (error) {
            console.error(`❌ [ORCHESTRATOR] Failed to resolve task for ${provider}:`, error.message);
        }
        
        return fallbackId;
    }
}

module.exports = PMOrchestrator;
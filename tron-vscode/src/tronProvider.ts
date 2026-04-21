import * as vscode from 'vscode';
import axios from 'axios';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);
const API_BASE_URL = 'https://tron-v2-3.onrender.com'; 

export class TaskTreeItem extends vscode.TreeItem {
    constructor(
        public readonly title: string,
        public readonly taskId: string,
        public readonly description: string,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState
    ) {
        super(title, collapsibleState);
        
        // The Hover Tooltip
        this.tooltip = new vscode.MarkdownString(`**${title}**\n\n${description}`);
        this.id = taskId;

        // 🌟 NEW: The Native Click Action!
        // When a user single-clicks this item in the sidebar, it fires your start command
        this.command = {
            command: 'tron.startTaskFromTree',
            title: 'Start Task',
            arguments: [this] // Passes the clicked task directly to your extension.ts
        };
    }
}

export class TronProvider implements vscode.TreeDataProvider<TaskTreeItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<TaskTreeItem | undefined | void> = new vscode.EventEmitter<TaskTreeItem | undefined | void>();
    readonly onDidChangeTreeData: vscode.Event<TaskTreeItem | undefined | void> = this._onDidChangeTreeData.event;

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: TaskTreeItem): vscode.TreeItem {
        return element;
    }

    async getChildren(element?: TaskTreeItem): Promise<TaskTreeItem[]> {
        if (element) {
            return Promise.resolve([]); // No nested tasks for now
        }

        try {
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (!workspaceFolders) return Promise.resolve([]);
            const cwd = workspaceFolders[0].uri.fsPath;

            // Get Repo Name
            const { stdout } = await execAsync('git config --get remote.origin.url', { cwd });
            const remoteUrl = stdout.trim();
            const repoMatch = remoteUrl.match(/github\.com[:\/](.+?\.git|.+)/);
            if (!repoMatch) return Promise.resolve([]);
            const repoName = repoMatch[1].replace('.git', '');

            // Fetch Tickets
            const getResponse = await axios.get(`${API_BASE_URL}/api/project/${encodeURIComponent(repoName)}/tickets`);
            const tickets = getResponse.data.tickets || [];

            // 2. Map to VS Code Tree Items to display the new State
            const tasks = tickets.map((t: any) => {
                const stateLabel = t.state ? `[${t.state}] ` : '';
                return new TaskTreeItem(
                    `${stateLabel}${t.title}`, // 🌟 Put the state and title together for the UI!
                    t.id.toString(),           // 🌟 STRICTLY the pure number for Git and the API!
                    t.description,
                    vscode.TreeItemCollapsibleState.None,
                );
            });

            

            return tasks;

        } catch (err: any) {
            vscode.window.showErrorMessage(`T.R.O.N: Failed to fetch tasks. Is the Node API running?`);
            return Promise.resolve([]);
        }
    }
}
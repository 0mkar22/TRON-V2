import * as vscode from 'vscode';
import axios from 'axios';
import { exec } from 'child_process';
import { promisify } from 'util';
import { TronProvider } from './tronProvider';

const execAsync = promisify(exec);
const API_BASE_URL = 'https://tron-v2-3.onrender.com';

// 🌟 NEW: Tell TypeScript about our custom QuickPick properties
interface TaskQuickPickItem extends vscode.QuickPickItem {
    taskId: string;
    rawTitle: string;
}

export function activate(context: vscode.ExtensionContext) {
    console.log('T.R.O.N. VS Code Extension is now active!');

    const tronProvider = new TronProvider();
    vscode.window.registerTreeDataProvider('tron-tickets', tronProvider);

    let refreshCmd = vscode.commands.registerCommand('tron.refreshTickets', () => {
        tronProvider.refresh();
        vscode.window.showInformationMessage('T.R.O.N: Tasks Refreshed');
    });

    // ==============================================
    // 🌟 THE UPDATED START TASK WORKFLOW
    // ==============================================
    let startTaskCmd = vscode.commands.registerCommand('tron.startTaskFromTree', async (task: any) => {
        try {
            const taskId = task.id || task.taskId;
            if (!taskId) return;

            // 🌟 1. Grab the task title to show in the confirmation box
            const taskTitle = task.title || task.rawTitle || `Task ${taskId}`;

            // 🌟 2. The Colleague's UX Fix: The Modal Confirmation Dialog
            const userChoice = await vscode.window.showWarningMessage(
                `Start working on "${taskTitle}"? \n\nThis will automatically stash your current work, create a new branch, and assign you on Basecamp.`,
                { modal: true }, // Forces them to interact with the popup
                'Yes, Start Task'
            );

            // If they close the modal or hit "Cancel", we silently exit
            if (userChoice !== 'Yes, Start Task') {
                return; 
            }

            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (!workspaceFolders) return;
            const cwd = workspaceFolders[0].uri.fsPath;

            // 🌟 1. GET THE LOCAL GIT USERNAME FIRST
            let gitUsername = 'dev';
            try {
                const { stdout: userOut } = await execAsync('git config user.name', { cwd });
                gitUsername = userOut.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
            } catch (e) {
                console.error("Could not fetch git username");
            }

            const { stdout } = await execAsync('git config --get remote.origin.url', { cwd });
            const remoteUrl = stdout.trim();
            const repoMatch = remoteUrl.match(/github\.com[:\/](.+?\.git|.+)/);
            if (!repoMatch) return;
            const repoName = repoMatch[1].replace('.git', '');

            vscode.window.showInformationMessage(`T.R.O.N: Syncing with Basecamp...`);

            let resolvedId = taskId;
            try {
                // 🌟 2. SEND THE USERNAME TO THE BACKEND
                const response = await axios.post(`${API_BASE_URL}/api/start-task`, {
                    taskInput: taskId,
                    repoName: repoName,
                    developer: gitUsername // <-- Passing the identity!
                });
                resolvedId = response.data.resolvedId; 
                vscode.window.showInformationMessage(`✅ T.R.O.N: Basecamp synchronized & assigned!`);
            } catch (apiError: any) {
                vscode.window.showErrorMessage(`T.R.O.N Backend Error: Could not sync with Basecamp.`);
                console.error("API Error details:", apiError);
                return; 
            }
            // ==============================================
            // 🌟 GET USERNAME & FORMAT THE TITLE
            // ==============================================
            // let gitUsername = 'dev';
            try {
                // Grab the local git user (e.g. "0mkar22") and clean it up
                const { stdout: userOut } = await execAsync('git config user.name', { cwd });
                gitUsername = userOut.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
            } catch (e) {
                console.error("Could not fetch git username, defaulting to 'dev'");
            }

            // Grab the raw title passed from the sidebar or popup, sanitize it, and shorten it
            const rawTitle = task.title || task.rawTitle || 'task';
            const formattedDesc = rawTitle.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').substring(0, 40);

            // 🌟 2. BUILD THE BOSS'S BRANCH FORMAT
            const branchName = `${gitUsername}/${resolvedId}-${formattedDesc}`;
            
            vscode.window.showInformationMessage(`T.R.O.N: Safely moving you to ${branchName}...`);

            // THE AUTO-STASH & CARRY SYSTEM
            let stashed = false;
            try {
                const { stdout: statusOut } = await execAsync('git status --porcelain', { cwd });
                if (statusOut.trim().length > 0) {
                    await execAsync('git stash push -m "TRON_AUTO_STASH"', { cwd });
                    stashed = true;
                }
            } catch (e) {
                console.error("T.R.O.N: Error checking git status", e);
            }

            // ==============================================
            // 🌟 CHECKOUT & AUTO-PUSH TO TRIGGER WEBHOOK
            // ==============================================
            try {
                // Check if branch already exists locally
                await execAsync(`git rev-parse --verify ${branchName}`, { cwd });
                await execAsync(`git checkout ${branchName}`, { cwd });
                vscode.window.showInformationMessage(`✅ T.R.O.N: Resumed existing branch ${branchName}`);
            } catch (err) {
                // Branch doesn't exist: Create it AND push it immediately!
                await execAsync(`git checkout -b ${branchName}`, { cwd });
                
                vscode.window.showInformationMessage(`⏳ T.R.O.N: Pushing branch to trigger backend automation...`);
                await execAsync(`git push -u origin ${branchName}`, { cwd });
                
                vscode.window.showInformationMessage(`✅ T.R.O.N: Created and pushed new branch! Basecamp will auto-assign shortly.`);
            }

            // Drop the dirty changes back into the developer's editor
            if (stashed) {
                try {
                    await execAsync('git stash pop', { cwd });
                    vscode.window.showInformationMessage(`✨ T.R.O.N: Successfully carried your code changes over to the task!`);
                } catch (popErr) {
                    vscode.window.showErrorMessage(`T.R.O.N Warning: Git merge conflict when carrying changes over. Please resolve manually.`);
                }
            }

            tronProvider.refresh();

        } catch (error: any) {
            vscode.window.showErrorMessage(`T.R.O.N Error: ${error.message}`);
        }
    });

    let createCmd = vscode.commands.registerCommand('tron.createTaskOnly', async () => {
        try {
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (!workspaceFolders) return;
            const cwd = workspaceFolders[0].uri.fsPath;

            const { stdout } = await execAsync('git config --get remote.origin.url', { cwd });
            const remoteUrl = stdout.trim();
            const repoMatch = remoteUrl.match(/github\.com[:\/](.+?\.git|.+)/);
            if (!repoMatch) return;
            const repoName = repoMatch[1].replace('.git', '');

            const input = await vscode.window.showInputBox({ prompt: 'Enter new task name (Adds to "To Do"):' });
            if (!input) return; 

            vscode.window.showInformationMessage(`T.R.O.N: Adding task to Basecamp...`);
            
            await axios.post(`${API_BASE_URL}/api/create-task`, {
                taskInput: input,
                repoName: repoName
            });
            
            vscode.window.showInformationMessage(`✅ T.R.O.N: Task added to To Do!`);
            tronProvider.refresh();

        } catch (error: any) {
            vscode.window.showErrorMessage(`T.R.O.N Error: ${error.message}`);
        }
    });

    let viewReviewCmd = vscode.commands.registerCommand('tron.viewAIReview', async (task: any) => {
        const taskId = task.id || task.taskId; 
        if (taskId === 'CREATE_NEW') return; 

        try {
            vscode.window.showInformationMessage(`T.R.O.N: Fetching AI Review...`);
            const response = await axios.get(`${API_BASE_URL}/api/review/${taskId}`);
            const reviewText = response.data.review;

            const panel = vscode.window.createWebviewPanel(
                'tronAIReview', 
                `AI Review: TASK-${taskId}`, 
                vscode.ViewColumn.Beside,
                { enableScripts: true }
            );

            panel.webview.html = `
                <!DOCTYPE html>
                <html lang="en">
                <head>
                    <meta charset="UTF-8">
                    <meta name="viewport" content="width=device-width, initial-scale=1.0">
                    <title>T.R.O.N. AI Code Review</title>
                    <style>
                        /* Base Variables linked to native VS Code themes */
                        :root {
                            --card-bg: var(--vscode-editorWidget-background);
                            --card-border: var(--vscode-widget-border);
                            --text-muted: var(--vscode-descriptionForeground);
                        }

                        body { 
                            font-family: var(--vscode-font-family), -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; 
                            padding: 32px 24px; 
                            line-height: 1.6; 
                            color: var(--vscode-editor-foreground); 
                            background-color: var(--vscode-editor-background);
                            max-width: 900px;
                            margin: 0 auto;
                        }

                        /* Header Styling */
                        .header {
                            display: flex;
                            align-items: center;
                            justify-content: space-between;
                            margin-bottom: 24px;
                            padding-bottom: 16px;
                            border-bottom: 1px solid var(--vscode-panel-border);
                        }

                        .header-title {
                            display: flex;
                            align-items: center;
                            gap: 12px;
                        }

                        .header h2 { 
                            margin: 0;
                            font-size: 1.5rem;
                            font-weight: 600;
                            color: var(--vscode-editor-foreground);
                        }

                        /* Task ID Badge */
                        .badge {
                            background-color: var(--vscode-badge-background);
                            color: var(--vscode-badge-foreground);
                            padding: 6px 12px;
                            border-radius: 4px;
                            font-size: 0.8rem;
                            font-weight: 600;
                            letter-spacing: 0.5px;
                            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
                        }

                        /* The Review Content Card */
                        .review-card {
                            background: var(--card-bg);
                            border: 1px solid var(--card-border);
                            border-radius: 8px;
                            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
                            overflow: hidden;
                        }

                        .review-card-header {
                            background: var(--vscode-editorGroupHeader-tabsBackground);
                            padding: 12px 20px;
                            border-bottom: 1px solid var(--card-border);
                            font-size: 0.85rem;
                            color: var(--text-muted);
                            text-transform: uppercase;
                            letter-spacing: 1px;
                            display: flex;
                            align-items: center;
                            gap: 8px;
                        }

                        /* AI Output Text */
                        pre { 
                            margin: 0;
                            padding: 24px; 
                            white-space: pre-wrap; 
                            word-wrap: break-word;
                            font-family: var(--vscode-editor-font-family), "Fira Code", monospace;
                            font-size: 0.95rem;
                            color: var(--vscode-editor-foreground);
                        }

                        .logo-icon {
                            font-size: 1.8rem;
                        }
                    </style>
                </head>
                <body>
                    <div class="header">
                        <div class="header-title">
                            <span class="logo-icon">💠</span>
                            <h2>T.R.O.N. Engine AI</h2>
                        </div>
                        <span class="badge">TASK-${taskId}</span>
                    </div>

                    <div class="review-card">
                        <div class="review-card-header">
                            <span>✨</span> Automated Code Analysis
                        </div>
                        <pre>${reviewText}</pre>
                    </div>
                </body>
                </html>
            `;
        } catch (error: any) {
            if (error.response && error.response.status === 404) {
                vscode.window.showInformationMessage(`T.R.O.N: No AI review generated for this task yet. Try pushing some code!`);
            } else {
                vscode.window.showErrorMessage(`T.R.O.N Error: Failed to fetch review. Is the API running?`);
            }
        }
    });

    let quickPickCmd = vscode.commands.registerCommand('tron.selectTaskPopup', async () => {
        try {
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (!workspaceFolders) return false;
            const cwd = workspaceFolders[0].uri.fsPath;

            const { stdout: remoteOut } = await execAsync('git config --get remote.origin.url', { cwd });
            const repoMatch = remoteOut.trim().match(/github\.com[:\/](.+?\.git|.+)/);
            if (!repoMatch) return false;
            const repoName = repoMatch[1].replace('.git', '');

            vscode.window.showInformationMessage('✨ T.R.O.N: Analyzing your uncommitted code...');

            let codeDiff = "";
            try {
                const { stdout: diffOut } = await execAsync('git diff', { cwd });
                codeDiff = diffOut.trim();
            } catch (e) {
                console.error("Git diff failed", e);
            }

            const encodedRepo = encodeURIComponent(repoName);
            const [ticketsRes, aiRes] = await Promise.all([
                axios.get(`${API_BASE_URL}/api/project/${encodedRepo}/tickets`).catch(() => ({ data: { tickets: [] } })),
                codeDiff ? axios.post(`${API_BASE_URL}/api/suggest-tasks`, { codeDiff }).catch(() => ({ data: { suggestions: [] } })) : Promise.resolve({ data: { suggestions: [] } })
            ]);

            const tickets = ticketsRes.data.tickets || [];
            const aiSuggestions = aiRes.data.suggestions || [];

            const quickPickItems: TaskQuickPickItem[] = [];

            aiSuggestions.forEach((suggestion: string) => {
                quickPickItems.push({
                    label: `✨ Create: "${suggestion}"`,
                    description: "AI Generated based on your code",
                    taskId: suggestion, 
                    rawTitle: suggestion
                });
            });

            tickets.forEach((t: any) => {
                quickPickItems.push({
                    label: `[${t.state || 'To Do'}] ${t.title}`,
                    description: `ID: ${t.id}`,
                    detail: t.description || "No description available",
                    taskId: t.id.toString(),
                    rawTitle: t.title
                });
            });

            if (quickPickItems.length === 0) {
                vscode.window.showInformationMessage("T.R.O.N: No tasks or suggestions found.");
                return false;
            }

            const selection = await vscode.window.showQuickPick<TaskQuickPickItem>(quickPickItems, {
                placeHolder: 'Which task are you working on right now?',
                matchOnDescription: true,
                matchOnDetail: true
            });

            if (selection) {
                vscode.commands.executeCommand('tron.startTaskFromTree', { id: selection.taskId, title: selection.rawTitle });
                return true; 
            } else {
                return false; 
            }

        } catch (error) {
            console.error("Popup Error:", error);
            return false;
        }
    });

    let hasPromptedForTask = false;
    let isCheckingBranch = false; 

    vscode.workspace.onDidSaveTextDocument(async (document) => {
        if (document.uri.scheme !== 'file') return;
        if (hasPromptedForTask || isCheckingBranch) return;

        isCheckingBranch = true; 

        try {
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (!workspaceFolders) {
                isCheckingBranch = false;
                return;
            }
            const cwd = workspaceFolders[0].uri.fsPath;

            const { stdout } = await execAsync('git rev-parse --abbrev-ref HEAD', { cwd });
            const currentBranch = stdout.trim();

            // 🌟 Updated to check for the new branch format!
            const branchRegex = /^([^/]+)\/(\d+)-(.+)$/;
            if (currentBranch === 'main' || currentBranch === 'master' || !branchRegex.test(currentBranch)) {
                hasPromptedForTask = true; 

                vscode.window.showInformationMessage(`T.R.O.N: Unlinked code changes detected. What are you working on?`);
                
                const didSelectTask = await vscode.commands.executeCommand('tron.selectTaskPopup');
                
                if (!didSelectTask) {
                    hasPromptedForTask = false;
                }
            } else {
                hasPromptedForTask = true;
            }
        } catch (error) {
            // Ignore Git errors
        } finally {
            isCheckingBranch = false; 
        }
    });

    const workspaceFoldersList = vscode.workspace.workspaceFolders;
    if (workspaceFoldersList) {
        const cwd = workspaceFoldersList[0].uri.fsPath;
        const gitWatcher = vscode.workspace.createFileSystemWatcher(
            new vscode.RelativePattern(cwd, '.git/HEAD')
        );
        
        gitWatcher.onDidChange(() => {
            hasPromptedForTask = false; 
        });

        context.subscriptions.push(gitWatcher);
    }

    context.subscriptions.push(refreshCmd, startTaskCmd, createCmd, viewReviewCmd, quickPickCmd);
}

export function deactivate() {}
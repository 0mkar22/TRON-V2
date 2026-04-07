# 🚀 T.R.O.N. V2 (Task Resolution & Orchestration Network)

T.R.O.N. is an AI-powered, enterprise-grade internal developer platform. It acts as the connective tissue between a developer's local environment, Project Management software (Basecamp), Version Control (GitHub), and Team Communication (Discord/Teams).

## 🏗️ Architecture: Hub and Spoke

T.R.O.N. is built on a **Hub and Spoke** model to ensure centralized management by PMs/Admins while providing a frictionless, zero-config experience for developers.

* **The Spoke (`tron-daemon`):** A lightweight, invisible Go binary running on the developer's machine. It watches for file saves, reads Git states, and prompts developers with active tasks.
* **The Hub (`tron-router`):** A Node.js Cloud Router powered by Express and Redis. It securely manages enterprise API keys, handles GitHub Webhooks, orchestrates AI Code Reviews, and broadcasts to communication channels.

---

## ✨ Key Features

* **🧠 Context-Aware Local Daemon:** Automatically detects when a developer is writing code on a tracked project, intercepting file saves to prompt for task selection without interrupting the terminal.
* **🛡️ 5-Second Git Shield:** Intelligently ignores internal Git operations (like `checkout`, `pull`, `merge`) to prevent ghost triggers and annoying pop-ups.
* **🤖 AI-Powered Pull Request Reviews:** Listens to GitHub webhooks and uses OpenRouter AI to automatically review code diffs, translating technical changes into business value.
* **📢 Cross-Platform Broadcasting:** Automatically sends rich embeds to Discord/Slack when PRs are opened, reviewed, or merged.
* **🏢 Centralized `tron.yaml` Routing:** Admins can route dozens of GitHub repositories to different Basecamp boards and Discord channels from a single config file, with zero changes required by developers.

---

## 📂 Repository Structure

This is a Monorepo containing both the Client and the Server.

```text
TRON-V2/
│
├── tron-daemon/             # The Client (Go)
│   ├── main.go              # Core file watcher and prompt logic
│   ├── install.ps1          # Enterprise rollout script for developers
│   └── internal/            # Git hooks and state management
│
└── tron-router/             # The Server (Node.js)
    ├── src/index.js         # Express API Gateway & Webhook listener
    ├── src/worker.js        # Redis Background Worker (AI processing)
    ├── src/adapters/        # Basecamp, GitHub, Discord, AI integrations
    ├── tron.yaml            # The Master Routing Configuration
    └── render.yaml          # Infrastructure-as-Code for Cloud Deployment

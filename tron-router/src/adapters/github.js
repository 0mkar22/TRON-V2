const axios = require('axios');

const GITHUB_TOKEN = process.env.GITHUB_ACCESS_TOKEN;

const githubAPI = axios.create({
    headers: {
        'Authorization': `Bearer ${GITHUB_TOKEN}`,
        'Accept': 'application/vnd.github.v3.diff', // This tells GitHub we want raw diff text, not JSON!
        'User-Agent': 'TRON-AI-Pipeline'
    }
});

// The "Monster Diff" Sanitizer (REQ-9 & REQ-10)
async function fetchAndSanitizeDiff(diffUrl) {
    console.log(`\n📥 [GITHUB ADAPTER] Fetching raw code diff from: ${diffUrl}`);

    if (!GITHUB_TOKEN) {
        throw new Error("Missing GITHUB_ACCESS_TOKEN in .env");
    }

    try {
        const response = await githubAPI.get(diffUrl);
        let rawDiff = response.data;

        console.log(`🧹 [GITHUB ADAPTER] Sanitizing Monster Diffs...`);

        // 🛡️ SECURITY FIX: The Secret Scrubber (DLP)
        const secretPatterns = [
            /(A3T[A-Z0-9]|AKIA|AGPA|AIDA|AROA|AIPA|ANPA|ANVA|ASIA)[A-Z0-9]{16}/g, // AWS Access Keys
            /-----BEGIN (RSA|EC|DSA|OPENSSH) PRIVATE KEY-----\n[\s\S]*?\n-----END \1 PRIVATE KEY-----/g, // SSH/RSA Private Keys
            /(password|secret|api_key|access_token|client_secret)[ \t]*[:=][ \t]*['"]?[^\s'"]+['"]?/gi // Generic hardcoded secrets
        ];

        let originalLength = rawDiff.length;
        secretPatterns.forEach(pattern => {
            rawDiff = rawDiff.replace(pattern, '[REDACTED_SECRET]');
        });

        if (rawDiff.length !== originalLength) {
            console.warn(`🚨 [GITHUB ADAPTER] WARNING: Secrets detected and redacted from PR diff!`);
        }

        // 1. Remove lockfiles (package-lock.json, yarn.lock)
        rawDiff = rawDiff.replace(/diff --git a\/.*(?:package-lock\.json|yarn\.lock)[\s\S]*?(?=diff --git|$)/g, '');
        
        // 2. Remove minified files and SVGs
        rawDiff = rawDiff.replace(/diff --git a\/.*\.(?:min\.js|svg|map)[\s\S]*?(?=diff --git|$)/g, '');

        // 3. Enforce Hard Token Limits (Approx. 12,000 characters to stay safe for LLMs)
        const MAX_CHARS = 12000;
        if (rawDiff.length > MAX_CHARS) {
            console.warn(`⚠️ [GITHUB ADAPTER] Diff exceeds ${MAX_CHARS} characters. Truncating to protect LLM limit.`);
            rawDiff = rawDiff.substring(0, MAX_CHARS) + '\n\n... [DIFF TRUNCATED BY T.R.O.N. DUE TO LENGTH] ...';
        }

        console.log(`✅ [GITHUB ADAPTER] Diff sanitized. Final length: ${rawDiff.length} characters.`);
        return rawDiff;

    } catch (error) {
        console.error(`❌ [GITHUB ADAPTER] Failed to fetch diff from GitHub.`);
        throw error;
    }
}

// 📢 NEW: Post a comment directly to a Pull Request
async function postPullRequestComment(repoFullName, prNumber, commentBody) {
    if (!GITHUB_TOKEN) {
        console.warn("⚠️ GITHUB_ACCESS_TOKEN is missing in .env. Cannot post PR comment.");
        return;
    }

    // GitHub's API endpoint for PR comments is actually the Issues endpoint!
    const url = `https://api.github.com/repos/${repoFullName}/issues/${prNumber}/comments`;
    
    const headers = {
        'Authorization': `Bearer ${GITHUB_TOKEN}`,
        'Accept': 'application/vnd.github.v3+json', // We need JSON for this call, not diff
        'Content-Type': 'application/json',
        'User-Agent': 'TRON-AI-Pipeline'
    };

    try {
        await axios.post(url, { body: commentBody }, { headers });
        console.log(`💬 Successfully posted AI review to PR #${prNumber}`);
    } catch (error) {
        console.error(`❌ [GITHUB ADAPTER] Failed to post PR comment: ${error.message}`);
        if (error.response) {
            console.error(`   -> Details:`, JSON.stringify(error.response.data, null, 2));
        }
    }
}

// Ensure both functions are exported!
module.exports = { fetchAndSanitizeDiff, postPullRequestComment };
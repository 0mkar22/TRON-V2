const { OpenAI } = require('openai');

// Initialize the client pointing to OpenRouter instead of OpenAI!
const openai = new OpenAI({
    baseURL: "https://openrouter.ai/api/v1",
    apiKey: process.env.OPENROUTER_API_KEY,
    defaultHeaders: {
        "HTTP-Referer": "http://localhost:3000", // Required by OpenRouter
        "X-Title": "T.R.O.N. Local Watcher", // Required by OpenRouter
    }
});

// ==========================================
// THE INTELLIGENCE ENGINE
// ==========================================
async function generateExecutiveSummary(prTitle, sanitizedDiff) {
    // 🛡️ QoL UPDATE: Don't waste AI credits on empty diffs
    if (!sanitizedDiff || sanitizedDiff.trim().length === 0) {
        console.log(`\n⏭️  [AI ADAPTER] Diff is empty after sanitization. Skipping LLM.`);
        return {
            intent: "Infrastructure",
            executive_summary: "Automated updates to lockfiles, generated assets, or ignored files.",
            business_impact: "No direct user impact. Routine maintenance.",
            confidence_score: 100
        };
    }
    console.log(`\n🤖 [AI ADAPTER] Analyzing code diff via OpenRouter for PR: "${prTitle}"...`);

    const systemPrompt = `
    You are an elite Staff Software Engineer translating technical code changes into business intelligence.
    Read the provided Git diff and summarize exactly what changed and why it matters.
    
    RULES:
    1. Do not use overly technical jargon.
    2. Focus on the business value.
    3. You MUST respond in pure, raw JSON format matching the exact structure below.
    
    JSON STRUCTURE:
    {
        "intent": "Feature" | "Bug Fix" | "Refactoring" | "Infrastructure",
        "executive_summary": "A 2-3 sentence human-readable summary of the changes.",
        "business_impact": "A 1 sentence explanation of how this affects the user.",
        "confidence_score": <number between 1 and 100 representing how certain you are of this summary>
    }
    `;

    try {
        const response = await openai.chat.completions.create({
            model: "openrouter/free", 
            messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: `PR Title: ${prTitle}\n\nCode Diff:\n${sanitizedDiff}` }
            ],
            temperature: 0.1 
        });

        let rawContent = response.choices[0].message.content.trim();
        const jsonMatch = rawContent.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
            throw new Error("AI did not return a valid JSON structure.");
        }

        const aiResult = JSON.parse(jsonMatch[0]);
        
        console.log(`✅ [AI ADAPTER] Analysis Complete! Intent: ${aiResult.intent}`);
        return aiResult;

    } catch (error) {
        console.error(`❌ [AI ADAPTER] Failed to generate summary:`, error.message);
        return {
            intent: "Unknown",
            executive_summary: `Developer opened PR: ${prTitle}. AI analysis failed or timed out.`,
            business_impact: "Requires manual review.",
            confidence_score: 0 
        };
    }
}

// ==========================================
// 🕵️‍♂️ NEW: THE CODE REVIEWER ENGINE
// ==========================================
async function generateCodeReview(sanitizedDiff) {
    if (!sanitizedDiff || sanitizedDiff.trim().length === 0) return "✅ **No code changes detected.**";

    console.log(`🤖 [AI ADAPTER] Performing deep technical code review...`);

    const reviewPrompt = `
    You are a strict, senior software engineer performing a technical code review.
    Review the following Git diff for logic errors, security vulnerabilities, or performance bottlenecks.
    
    RULES:
    1. If the code is perfect, respond ONLY with: "✅ **Code looks solid.** No major issues detected by T.R.O.N."
    2. If there are issues, list them using Markdown bullet points. 
    3. Be direct, technical, and helpful. Use code blocks for suggestions.
    4. Limit your response to the top 3 most critical findings.
    `;

    try {
        const response = await openai.chat.completions.create({
            model: "openrouter/free", 
            messages: [
                { role: "system", content: reviewPrompt },
                { role: "user", content: `Code Diff:\n${sanitizedDiff}` }
            ],
            temperature: 0.3 // Slightly higher for more creative debugging insight
        });

        return response.choices[0].message.content.trim();

    } catch (error) {
        console.error(`❌ [AI ADAPTER] Code Review Failed:`, error.message);
        return "⚠️ T.R.O.N. was unable to generate a code review due to a technical error.";
    }
}

// ==========================================
// 🛡️ THE WRAPPER FUNCTION FOR TEST SCRIPT & DISCORD
// ==========================================
async function generateSummary(diffData) {
    const aiJsonResult = await generateExecutiveSummary("Manual Diff Test", diffData);
    
    return `
**🎯 Intent:** ${aiJsonResult.intent}
**💼 Business Impact:** ${aiJsonResult.business_impact}
**📝 Summary:** ${aiJsonResult.executive_summary}
**🛡️ Confidence Score:** ${aiJsonResult.confidence_score || 0}/100
    `.trim();
}

// 🛡️ Export all functions
module.exports = { 
    generateExecutiveSummary, 
    generateCodeReview,
    generateSummary 
};
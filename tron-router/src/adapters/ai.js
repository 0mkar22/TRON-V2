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
        console.log(`⏭️  [AI ADAPTER] Diff is empty after sanitization. Skipping LLM.`);
        return {
            intent: "Infrastructure",
            executive_summary: "Automated updates to lockfiles, generated assets, or ignored files.",
            business_impact: "No direct user impact. Routine maintenance."
        };
    }
    console.log(`\n🤖 [AI ADAPTER] Analyzing code diff via OpenRouter for PR: "${prTitle}"...`);

    const systemPrompt = `
    You are an elite Staff Software Engineer translating technical code changes into business intelligence.
    Read the provided Git diff and summarize exactly what changed and why it matters.
    
    RULES:
    1. Do not use overly technical jargon.
    2. Focus on the business value.
    3. You MUST respond in pure, raw JSON format matching the exact structure below. Do not include markdown blocks, backticks, or any other text.
    
    JSON STRUCTURE:
    {
        "intent": "Feature" | "Bug Fix" | "Refactoring" | "Infrastructure",
        "executive_summary": "A 2-3 sentence human-readable summary of the changes.",
        "business_impact": "A 1 sentence explanation of how this affects the user or system."
    }
    `;

    try {
        const response = await openai.chat.completions.create({
            // Let's use a solid, free model available on OpenRouter
            model: "openrouter/free", 
            messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: `PR Title: ${prTitle}\n\nCode Diff:\n${sanitizedDiff}` }
            ],
            // Note: Many free OpenRouter models don't support strict JSON mode natively, 
            // so we rely on the aggressive system prompt above to format it correctly!
            temperature: 0.1 
        });

        // Clean up the response just in case the free model adds markdown backticks
        let rawContent = response.choices[0].message.content.trim();
        // rawContent = rawContent.replace(/^```json/i, '').replace(/^```/i, '').replace(/```$/i, '').trim();
        // 🛡️ THE FIX: Extract only the JSON block using Regex
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
            business_impact: "Requires manual review."
        };
    }
}

module.exports = { generateExecutiveSummary };
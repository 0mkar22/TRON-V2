const crypto = require('crypto');

function verifyGitHub(req, res, next) {
    const signature = req.headers['x-hub-signature-256'];
    const secret = process.env.GITHUB_WEBHOOK_SECRET;

    if (!signature) {
        console.warn('⚠️  Rejected: Missing GitHub Signature');
        return res.status(401).send('Unauthorized: No signature');
    }

    const hmac = crypto.createHmac('sha256', secret);
    const digest = 'sha256=' + hmac.update(req.rawBody).digest('hex');

    if (signature.length !== digest.length || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(digest))) {
        console.warn('🚨 Rejected: Signature mismatch (Potential spoofing attack!)');
        return res.status(401).send('Unauthorized: Invalid signature');
    }

    console.log('✅ Webhook Cryptographically Verified');
    next();
}

module.exports = verifyGitHub;
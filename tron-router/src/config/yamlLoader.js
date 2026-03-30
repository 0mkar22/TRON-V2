const fs = require('fs');
const yaml = require('js-yaml');
const path = require('path');

function loadConfig() {
    try {
        const configPath = path.join(__dirname, '../../tron.yaml');
        const fileContents = fs.readFileSync(configPath, 'utf8');
        const data = yaml.load(fileContents);
        console.log('✅ YAML Configuration Loaded Successfully');
        return data;
    } catch (e) {
        console.error('❌ FATAL ERROR: Failed to load tron.yaml');
        console.error(e.message);
        process.exit(1);
    }
}

module.exports = loadConfig;
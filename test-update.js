// Test version - processes only first 3 tools
const fs = require('fs');
const updateScript = require('./update-registry.js');

// Create a minimal registry.toml for testing
const testToml = `[tools]
actionlint.description = "Static checker for GitHub Actions workflow files"
actionlint.backends = [
    "aqua:rhysd/actionlint",
    "ubi:rhysd/actionlint",
    "asdf:crazy-matt/asdf-actionlint",
    "go:github.com/rhysd/actionlint/cmd/actionlint"
]
actionlint.test = ["actionlint --version", "{{version}}"]

act.description = "Run your GitHub Actions locally"
act.backends = ["aqua:nektos/act", "ubi:nektos/act", "asdf:gr1m0h/asdf-act"]
act.test = ["act --version", "act version {{version}}"]

age.description = "A simple, modern and secure encryption tool"
age.backends = ["aqua:FiloSottile/age", "asdf:threkk/asdf-age"]
age.test = ["age --version", "v{{version}}"]
`;

fs.writeFileSync('test-registry.toml', testToml);

// Modify the main function to use test file
const originalReadFileSync = fs.readFileSync;
fs.readFileSync = function(filename, encoding) {
    if (filename === 'registry.toml') {
        return testToml;
    }
    return originalReadFileSync.call(this, filename, encoding);
};

// Run the test
console.log('Running test with 3 tools...');
require('./update-registry.js');
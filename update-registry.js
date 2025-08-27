#!/usr/bin/env node

const fs = require('fs');
const https = require('https');
const { URL } = require('url');

// Configuration
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || '';
const RATE_LIMIT_DELAY = GITHUB_TOKEN ? 100 : 1000; // ms between requests
const MAX_CONCURRENT = GITHUB_TOKEN ? 10 : 3;

// Command line arguments
const PREFIX_FILTER = process.argv.find(arg => arg.startsWith('--prefix='))?.split('=')[1];
const MERGE_MODE = process.argv.includes('--merge');
const REGENERATE = process.argv.includes('--regenerate') || process.argv.includes('--force');
const MAX_AGE_ARG = process.argv.find(arg => arg.startsWith('--max-age='))?.split('=')[1];
const HELP = process.argv.includes('--help') || process.argv.includes('-h');

// Parse max age (default: 7 days)
const MAX_AGE_HOURS = MAX_AGE_ARG ? parseMaxAge(MAX_AGE_ARG) : 24 * 7; // 7 days default

function parseMaxAge(ageStr) {
    const match = ageStr.match(/^(\d+)([hdw])$/);
    if (!match) {
        throw new Error('Invalid max-age format. Use format like: 2h, 3d, 1w');
    }
    
    const value = parseInt(match[1]);
    const unit = match[2];
    
    switch (unit) {
        case 'h': return value;
        case 'd': return value * 24;
        case 'w': return value * 24 * 7;
        default: throw new Error('Invalid time unit. Use h (hours), d (days), or w (weeks)');
    }
}

// Parse TOML function (simplified for our needs)
function parseRegistryTOML(tomlText) {
    const result = { tools: {} };
    const lines = tomlText.split('\n');
    let inToolsSection = false;
    let inMultilineArray = false;
    let currentArrayKey = null;
    let currentArrayContent = [];
    
    for (let i = 0; i < lines.length; i++) {
        let line = lines[i].trim();
        
        if (!line || line.startsWith('#')) continue;
        
        if (line === '[tools]') {
            inToolsSection = true;
            continue;
        }
        
        if (!inToolsSection) continue;
        
        if (inMultilineArray) {
            if (line.endsWith(']')) {
                line = line.replace(/]$/, '');
                if (line.trim()) {
                    currentArrayContent.push(...line.split(',').map(item => 
                        item.trim().replace(/^["']|["']$/g, '')
                    ).filter(item => item));
                }
                
                const [toolName, property] = currentArrayKey.split('.', 2);
                if (!result.tools[toolName]) {
                    result.tools[toolName] = {};
                }
                result.tools[toolName][property] = currentArrayContent;
                
                inMultilineArray = false;
                currentArrayKey = null;
                currentArrayContent = [];
            } else {
                if (line) {
                    currentArrayContent.push(...line.split(',').map(item => 
                        item.trim().replace(/^["']|["']$/g, '')
                    ).filter(item => item));
                }
            }
            continue;
        }
        
        if (line.includes(' = ')) {
            const [key, ...valueParts] = line.split(' = ');
            const value = valueParts.join(' = ');
            
            if (key.includes('.')) {
                const [toolName, property] = key.split('.', 2);
                
                if (!result.tools[toolName]) {
                    result.tools[toolName] = {};
                }
                
                if (value.startsWith('[') && value.endsWith(']')) {
                    const arrayContent = value.slice(1, -1);
                    if (arrayContent.trim()) {
                        result.tools[toolName][property] = arrayContent
                            .split(',')
                            .map(item => item.trim().replace(/^["']|["']$/g, ''))
                            .filter(item => item);
                    } else {
                        result.tools[toolName][property] = [];
                    }
                } else if (value.startsWith('[') && !value.endsWith(']')) {
                    inMultilineArray = true;
                    currentArrayKey = key;
                    currentArrayContent = [];
                    
                    const firstLine = value.slice(1);
                    if (firstLine.trim()) {
                        currentArrayContent.push(...firstLine.split(',').map(item => 
                            item.trim().replace(/^["']|["']$/g, '')
                        ).filter(item => item));
                    }
                } else if (value.startsWith('"') && value.endsWith('"')) {
                    result.tools[toolName][property] = value.slice(1, -1);
                } else {
                    result.tools[toolName][property] = value.replace(/^["']|["']$/g, '');
                }
            }
        }
    }
    
    return result;
}

// Extract GitHub repos from backends
function extractGitHubRepos(tool) {
    const repos = new Set();
    
    if (tool.backends) {
        tool.backends.forEach(backend => {
            const [type, repo] = backend.split(':', 2);
            
            if (type === 'aqua' || type === 'ubi') {
                repos.add(repo);
            } else if (type === 'go' && repo.startsWith('github.com/')) {
                const parts = repo.split('/');
                if (parts.length >= 3) {
                    repos.add(`${parts[1]}/${parts[2]}`);
                }
            } else if (type === 'asdf') {
                if (repo.startsWith('https://github.com/')) {
                    const url = new URL(repo);
                    const pathParts = url.pathname.split('/').filter(p => p);
                    if (pathParts.length >= 2) {
                        repos.add(`${pathParts[0]}/${pathParts[1]}`);
                    }
                } else if (!repo.includes('mise-plugins/') && repo.includes('/')) {
                    repos.add(repo);
                }
            }
        });
    }
    
    return Array.from(repos);
}

// Fetch GitHub repo data
function fetchGitHubRepo(owner, repo) {
    return new Promise((resolve, reject) => {
        const options = {
            hostname: 'api.github.com',
            port: 443,
            path: `/repos/${owner}/${repo}`,
            method: 'GET',
            headers: {
                'User-Agent': 'mise-registry-updater',
                'Accept': 'application/vnd.github.v3+json'
            }
        };

        if (GITHUB_TOKEN) {
            options.headers['Authorization'] = `token ${GITHUB_TOKEN}`;
        }

        const req = https.request(options, (res) => {
            let data = '';
            
            res.on('data', (chunk) => {
                data += chunk;
            });
            
            res.on('end', () => {
                try {
                    const parsed = JSON.parse(data);
                    if (res.statusCode === 200) {
                        resolve({
                            url: `https://github.com/${owner}/${repo}`,
                            stars: parsed.stargazers_count || 0,
                            topics: parsed.topics || [],
                            last_updated: parsed.updated_at,
                            description: parsed.description || '',
                            verified: true,
                            language: parsed.language
                        });
                    } else {
                        console.warn(`GitHub API error for ${owner}/${repo}: ${parsed.message || 'Unknown error'}`);
                        resolve({
                            url: `https://github.com/${owner}/${repo}`,
                            verified: false,
                            error: parsed.message || 'Repository not found'
                        });
                    }
                } catch (error) {
                    console.error(`JSON parse error for ${owner}/${repo}:`, error.message);
                    resolve({
                        url: `https://github.com/${owner}/${repo}`,
                        verified: false,
                        error: 'Invalid response'
                    });
                }
            });
        });
        
        req.on('error', (error) => {
            console.error(`Request error for ${owner}/${repo}:`, error.message);
            resolve({
                url: `https://github.com/${owner}/${repo}`,
                verified: false,
                error: error.message
            });
        });
        
        req.setTimeout(10000, () => {
            req.abort();
            resolve({
                url: `https://github.com/${owner}/${repo}`,
                verified: false,
                error: 'Request timeout'
            });
        });
        
        req.end();
    });
}

// Validate URL
async function validateUrl(url) {
    return new Promise((resolve) => {
        try {
            const parsedUrl = new URL(url);
            const options = {
                hostname: parsedUrl.hostname,
                port: parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80),
                path: parsedUrl.pathname + parsedUrl.search,
                method: 'HEAD',
                timeout: 5000
            };

            const client = parsedUrl.protocol === 'https:' ? https : require('http');
            
            const req = client.request(options, (res) => {
                resolve(res.statusCode < 400);
            });
            
            req.on('error', () => resolve(false));
            req.on('timeout', () => {
                req.abort();
                resolve(false);
            });
            
            req.end();
        } catch {
            resolve(false);
        }
    });
}

// Sleep function for rate limiting
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Process tools in batches
async function processToolsInBatches(tools, batchSize = MAX_CONCURRENT) {
    const toolEntries = Object.entries(tools);
    const enhanced = {};
    
    for (let i = 0; i < toolEntries.length; i += batchSize) {
        const batch = toolEntries.slice(i, i + batchSize);
        const promises = batch.map(async ([name, tool]) => {
            console.log(`Processing ${name}...`);
            
            const result = {
                ...tool,
                name,
                links: [],
                github: []
            };
            
            // Extract GitHub repositories
            const githubRepos = extractGitHubRepos(tool);
            
            // Fetch GitHub data for each repo
            for (const repoPath of githubRepos) {
                const [owner, repo] = repoPath.split('/');
                if (owner && repo) {
                    await sleep(RATE_LIMIT_DELAY);
                    const githubData = await fetchGitHubRepo(owner, repo);
                    result.github.push(githubData);
                    
                    if (githubData.verified) {
                        result.links.push({
                            type: 'github',
                            url: githubData.url,
                            verified: true
                        });
                    }
                }
            }
            
            // Add documentation links for verified GitHub repos
            const primaryGithub = result.github.find(g => g.verified);
            if (primaryGithub) {
                const docsUrl = `${primaryGithub.url}#readme`;
                const docsValid = await validateUrl(docsUrl);
                result.links.push({
                    type: 'docs',
                    url: docsUrl,
                    verified: docsValid
                });
            }
            
            return [name, result];
        });
        
        const batchResults = await Promise.all(promises);
        batchResults.forEach(([name, result]) => {
            enhanced[name] = result;
        });
        
        console.log(`Completed batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(toolEntries.length / batchSize)}`);
    }
    
    return enhanced;
}

// Filter tools by prefix
function filterToolsByPrefix(tools, prefix) {
    if (!prefix) return tools;
    
    const filtered = {};
    const lowerPrefix = prefix.toLowerCase();
    
    Object.entries(tools).forEach(([name, tool]) => {
        if (name.toLowerCase().startsWith(lowerPrefix)) {
            filtered[name] = tool;
        }
    });
    
    return filtered;
}

// Check if tool needs updating based on cache age
function needsUpdate(toolName, existingData) {
    if (REGENERATE) return true; // Force regenerate
    
    if (!existingData.tools[toolName]) return true; // Tool not in cache
    
    const toolData = existingData.tools[toolName];
    if (!toolData.last_enhanced) return true; // No enhancement timestamp
    
    const lastUpdated = new Date(toolData.last_enhanced);
    const maxAge = MAX_AGE_HOURS * 60 * 60 * 1000; // Convert to milliseconds
    const age = Date.now() - lastUpdated.getTime();
    
    return age > maxAge;
}

// Filter tools that need updating
function filterToolsNeedingUpdate(tools, existingData) {
    const needingUpdate = {};
    let skippedCount = 0;
    
    Object.entries(tools).forEach(([name, tool]) => {
        if (needsUpdate(name, existingData)) {
            needingUpdate[name] = tool;
        } else {
            skippedCount++;
        }
    });
    
    return { needingUpdate, skippedCount };
}

// Show help text
function showHelp() {
    console.log(`
🔧 Mise Registry Updater - Fetch GitHub data for tools

USAGE:
  node update-registry.js [OPTIONS]

OPTIONS:
  --prefix=<PREFIX>     Update only tools starting with PREFIX (e.g. --prefix=act)
  --regenerate, --force Force update even if tools are recently cached
  --max-age=<TIME>      Update tools older than TIME (e.g. --max-age=2d)
                        Format: <number><unit> where unit is h(ours), d(ays), or w(eeks)
                        Default: 7d (7 days)
  --merge              Explicitly merge with existing data (automatic with --prefix)
  --help, -h           Show this help text

TIME FORMATS:
  --max-age=2h         2 hours
  --max-age=3d         3 days  
  --max-age=1w         1 week

EXAMPLES:
  node update-registry.js --prefix=act
  node update-registry.js --prefix=g --max-age=2d
  node update-registry.js --prefix=act --regenerate
  node update-registry.js --max-age=1d

ENVIRONMENT:
  GITHUB_TOKEN         GitHub personal access token for higher rate limits
    `);
}

// Load existing enhanced registry for merging
function loadExistingEnhanced() {
    try {
        if (fs.existsSync('registry-enhanced.json')) {
            const content = fs.readFileSync('registry-enhanced.json', 'utf8');
            return JSON.parse(content);
        }
    } catch (error) {
        console.warn('Could not load existing enhanced registry:', error.message);
    }
    return { tools: {}, last_updated: null, stats: { total_tools: 0, github_repos: 0, verified_repos: 0 } };
}

// Merge new tools with existing enhanced data
function mergeEnhancedData(existing, newData) {
    const merged = {
        ...existing,
        tools: {
            ...existing.tools,
            ...newData
        },
        last_updated: new Date().toISOString()
    };
    
    // Recalculate stats
    merged.stats = {
        total_tools: Object.keys(merged.tools).length,
        github_repos: Object.values(merged.tools).reduce((acc, tool) => acc + tool.github.length, 0),
        verified_repos: Object.values(merged.tools).reduce((acc, tool) => 
            acc + tool.github.filter(g => g.verified).length, 0)
    };
    
    return merged;
}

// Add timestamp to processed tools
async function processToolsInBatchesWithTimestamp(tools, batchSize = MAX_CONCURRENT) {
    const enhanced = await processToolsInBatches(tools, batchSize);
    
    // Add timestamp to each processed tool
    const timestamp = new Date().toISOString();
    Object.values(enhanced).forEach(tool => {
        tool.last_enhanced = timestamp;
    });
    
    return enhanced;
}

// Main function
async function main() {
    try {
        // Show help if requested
        if (HELP) {
            showHelp();
            return;
        }
        
        console.log('Reading registry.toml...');
        const tomlContent = fs.readFileSync('registry.toml', 'utf8');
        const registry = parseRegistryTOML(tomlContent);
        
        // Filter tools by prefix if specified
        const allTools = registry.tools;
        let toolsToProcess = filterToolsByPrefix(allTools, PREFIX_FILTER);
        
        if (PREFIX_FILTER) {
            console.log(`Filtering tools with prefix "${PREFIX_FILTER}"`);
            console.log(`Found ${Object.keys(toolsToProcess).length} tools (out of ${Object.keys(allTools).length} total)`);
            
            if (Object.keys(toolsToProcess).length === 0) {
                console.log('❌ No tools found with that prefix');
                return;
            }
        } else {
            console.log(`Found ${Object.keys(toolsToProcess).length} tools (processing all)`);
        }
        
        // Load existing data and filter by cache age
        const existingData = loadExistingEnhanced();
        const { needingUpdate, skippedCount } = filterToolsNeedingUpdate(toolsToProcess, existingData);
        
        // Show caching status
        const maxAgeDesc = MAX_AGE_ARG || '7d';
        console.log(`Cache settings: max-age=${maxAgeDesc}, regenerate=${REGENERATE ? 'yes' : 'no'}`);
        
        if (skippedCount > 0) {
            console.log(`📋 Skipping ${skippedCount} recently updated tools (use --regenerate to force)`);
        }
        
        if (Object.keys(needingUpdate).length === 0) {
            console.log('✅ All tools are up to date! Use --regenerate to force update.');
            return;
        }
        
        // Show which tools will be processed
        const toolNames = Object.keys(needingUpdate).sort();
        console.log(`Tools to process: ${toolNames.slice(0, 10).join(', ')}${toolNames.length > 10 ? ` ... (${toolNames.length - 10} more)` : ''}`);
        
        console.log(`GitHub token: ${GITHUB_TOKEN ? 'provided' : 'not provided (rate limited)'}`);
        
        console.log('Processing tools and fetching GitHub data...');
        const enhanced = await processToolsInBatchesWithTimestamp(needingUpdate);
        
        let result;
        
        if (MERGE_MODE || PREFIX_FILTER || Object.keys(existingData.tools).length > 0) {
            console.log('Loading existing enhanced data for merging...');
            result = mergeEnhancedData(existingData, enhanced);
            console.log(`Merged with existing data. Total tools: ${result.stats.total_tools}`);
        } else {
            result = {
                tools: enhanced,
                last_updated: new Date().toISOString(),
                stats: {
                    total_tools: Object.keys(enhanced).length,
                    github_repos: Object.values(enhanced).reduce((acc, tool) => acc + tool.github.length, 0),
                    verified_repos: Object.values(enhanced).reduce((acc, tool) => 
                        acc + tool.github.filter(g => g.verified).length, 0)
                }
            };
        }
        
        console.log('Writing registry-enhanced.json...');
        fs.writeFileSync('registry-enhanced.json', JSON.stringify(result, null, 2));
        
        const processedCount = Object.keys(enhanced).length;
        console.log(`✅ Complete! Processed ${processedCount} tools, enhanced registry now has ${result.stats.total_tools} tools with ${result.stats.verified_repos}/${result.stats.github_repos} verified GitHub repos`);
        
        if (skippedCount > 0) {
            console.log(`💡 Skipped ${skippedCount} tools that were recently updated`);
        }
        
        if (PREFIX_FILTER) {
            console.log(`\n📝 Next steps:`);
            console.log(`- Run with different prefixes to update more tools`);
            console.log(`- Or run without --prefix to update remaining tools`);
            console.log(`- Use --regenerate to force update cached tools`);
        }
        
    } catch (error) {
        console.error('❌ Error:', error.message);
        process.exit(1);
    }
}

if (require.main === module) {
    main();
}
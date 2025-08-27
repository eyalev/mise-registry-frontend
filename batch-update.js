#!/usr/bin/env node

const fs = require('fs');
const { spawn } = require('child_process');

// Common prefixes to group tools efficiently
const COMMON_PREFIXES = [
    'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l', 'm',
    'n', 'o', 'p', 'q', 'r', 's', 't', 'u', 'v', 'w', 'x', 'y', 'z'
];

// Two-letter prefixes for dense areas
const DENSE_PREFIXES = [
    'ac', 'an', 'ap', 'ar', 'as', 'ba', 'bo', 'br', 'ca', 'ch', 'cl', 'co', 'cr',
    'da', 'de', 'do', 'el', 'ex', 'fi', 'fl', 'fr', 'gi', 'go', 'gr', 'he', 'in',
    'ja', 'ju', 'ka', 'ke', 'ku', 'la', 'le', 'li', 'ma', 'me', 'mi', 'mo', 'my',
    'ne', 'ni', 'no', 'op', 'pa', 'pl', 'po', 'pr', 'py', 're', 'ro', 'ru', 'sc',
    'se', 'sh', 'sl', 'sp', 'st', 'sw', 'ta', 'te', 'th', 'to', 'tr', 'ty', 'un',
    've', 'vi', 'wa', 'we', 'wi', 'wo', 'xa', 'ya', 'ze'
];

function parseRegistryTOML(tomlText) {
    const result = { tools: {} };
    const lines = tomlText.split('\n');
    let inToolsSection = false;
    
    for (let line of lines) {
        line = line.trim();
        
        if (!line || line.startsWith('#')) continue;
        
        if (line === '[tools]') {
            inToolsSection = true;
            continue;
        }
        
        if (!inToolsSection) continue;
        
        if (line.includes(' = ') && line.includes('.')) {
            const [key] = line.split(' = ');
            if (key.includes('.')) {
                const [toolName] = key.split('.', 2);
                if (!result.tools[toolName]) {
                    result.tools[toolName] = {};
                }
            }
        }
    }
    
    return result;
}

function analyzeToolDistribution() {
    try {
        const tomlContent = fs.readFileSync('registry.toml', 'utf8');
        const registry = parseRegistryTOML(tomlContent);
        const toolNames = Object.keys(registry.tools);
        
        console.log(`📊 Tool Distribution Analysis (${toolNames.length} total tools)\n`);
        
        // Analyze single letter prefixes
        console.log('Single letter prefixes:');
        const singleLetterStats = {};
        COMMON_PREFIXES.forEach(prefix => {
            const count = toolNames.filter(name => name.toLowerCase().startsWith(prefix)).length;
            singleLetterStats[prefix] = count;
            if (count > 0) {
                const bar = '█'.repeat(Math.max(1, Math.floor(count / 5)));
                console.log(`  ${prefix.toUpperCase()}: ${count.toString().padStart(3)} ${bar}`);
            }
        });
        
        // Find dense prefixes that might need two-letter breakdown
        const densePrefixes = Object.entries(singleLetterStats)
            .filter(([prefix, count]) => count > 30)
            .map(([prefix]) => prefix);
            
        if (densePrefixes.length > 0) {
            console.log(`\n📝 Suggested two-letter prefixes for dense areas (>${30} tools):`);
            densePrefixes.forEach(prefix => {
                const twoLetterCounts = {};
                for (let second = 'a'; second <= 'z'; second = String.fromCharCode(second.charCodeAt(0) + 1)) {
                    const twoLetterPrefix = prefix + second;
                    const count = toolNames.filter(name => name.toLowerCase().startsWith(twoLetterPrefix)).length;
                    if (count > 0) {
                        twoLetterCounts[twoLetterPrefix] = count;
                    }
                }
                
                const sortedTwoLetter = Object.entries(twoLetterCounts)
                    .sort(([,a], [,b]) => b - a)
                    .slice(0, 5);
                    
                console.log(`  ${prefix.toUpperCase()}: ${sortedTwoLetter.map(([p, c]) => `${p}(${c})`).join(', ')}`);
            });
        }
        
        return { toolNames, singleLetterStats };
        
    } catch (error) {
        console.error('Error analyzing tools:', error.message);
        return null;
    }
}

function generateBatchCommands(useToken = false) {
    const analysis = analyzeToolDistribution();
    if (!analysis) return;
    
    const { singleLetterStats } = analysis;
    const baseCmd = useToken ? 'npm run update-prefix-token' : 'npm run update-prefix';
    
    console.log(`\n🚀 Suggested batch update commands:\n`);
    
    // Generate commands for prefixes with tools
    const commands = [];
    Object.entries(singleLetterStats)
        .filter(([prefix, count]) => count > 0)
        .sort(([,a], [,b]) => b - a) // Sort by count, descending
        .forEach(([prefix, count]) => {
            const cmd = `${baseCmd}=${prefix}`;
            commands.push({ cmd, count, prefix });
        });
    
    // Show commands grouped by estimated time
    const fastCommands = commands.filter(c => c.count <= 10);
    const mediumCommands = commands.filter(c => c.count > 10 && c.count <= 30);
    const slowCommands = commands.filter(c => c.count > 30);
    
    if (fastCommands.length > 0) {
        console.log('⚡ Fast updates (≤10 tools each):');
        fastCommands.forEach(({cmd, count, prefix}) => {
            console.log(`  ${cmd.padEnd(35)} # ${count} tools`);
        });
    }
    
    if (mediumCommands.length > 0) {
        console.log('\n⏱️  Medium updates (11-30 tools each):');
        mediumCommands.forEach(({cmd, count, prefix}) => {
            console.log(`  ${cmd.padEnd(35)} # ${count} tools`);
        });
    }
    
    if (slowCommands.length > 0) {
        console.log('\n🐌 Slower updates (>30 tools each):');
        slowCommands.forEach(({cmd, count, prefix}) => {
            console.log(`  ${cmd.padEnd(35)} # ${count} tools - consider using 2-letter prefixes`);
        });
    }
    
    const totalEstimate = useToken ? 
        Math.ceil(commands.reduce((sum, c) => sum + c.count, 0) * 0.2) : // ~0.2 minutes per tool with token
        Math.ceil(commands.reduce((sum, c) => sum + c.count, 0) * 4);    // ~4 minutes per tool without token
        
    console.log(`\n⏰ Estimated total time: ${totalEstimate} minutes ${useToken ? 'with token' : 'without token'}`);
    
    return commands;
}

async function runBatchUpdate(prefixes, useToken = false) {
    console.log(`🚀 Starting batch update for prefixes: ${prefixes.join(', ')}\n`);
    
    for (let i = 0; i < prefixes.length; i++) {
        const prefix = prefixes[i];
        const cmd = useToken ? 'npm' : 'npm';
        const args = useToken ? 
            ['run', 'update-prefix-token', `--prefix=${prefix}`] :
            ['run', 'update-prefix', `--prefix=${prefix}`];
            
        console.log(`📦 [${i + 1}/${prefixes.length}] Processing prefix "${prefix}"...`);
        
        try {
            await new Promise((resolve, reject) => {
                const child = spawn(cmd, args, { stdio: 'inherit' });
                child.on('close', (code) => {
                    if (code === 0) {
                        resolve();
                    } else {
                        reject(new Error(`Command failed with code ${code}`));
                    }
                });
            });
            
            console.log(`✅ Completed prefix "${prefix}"\n`);
        } catch (error) {
            console.error(`❌ Failed prefix "${prefix}":`, error.message);
            console.log('Continuing with next prefix...\n');
        }
    }
    
    console.log('🎉 Batch update complete!');
}

// CLI interface
function main() {
    const args = process.argv.slice(2);
    const command = args[0];
    
    if (command === 'analyze' || !command) {
        analyzeToolDistribution();
        if (!command) {
            console.log(`\n💡 Usage:`);
            console.log(`  node batch-update.js analyze                    # Show tool distribution`);
            console.log(`  node batch-update.js commands [--token]         # Show suggested commands`);
            console.log(`  node batch-update.js run <prefixes> [--token]   # Run batch update`);
            console.log(`\nExamples:`);
            console.log(`  node batch-update.js commands --token`);
            console.log(`  node batch-update.js run a,b,c --token`);
        }
    } else if (command === 'commands') {
        const useToken = args.includes('--token');
        generateBatchCommands(useToken);
    } else if (command === 'run') {
        const prefixArg = args[1];
        const useToken = args.includes('--token');
        
        if (!prefixArg) {
            console.error('❌ Please provide prefixes: node batch-update.js run a,b,c');
            process.exit(1);
        }
        
        const prefixes = prefixArg.split(',').map(p => p.trim());
        runBatchUpdate(prefixes, useToken);
    } else {
        console.error('❌ Unknown command:', command);
        process.exit(1);
    }
}

if (require.main === module) {
    main();
}
let allTools = [];
let filteredTools = [];

function parseRegistryTOML(tomlText) {
    const result = { tools: {} };
    const lines = tomlText.split('\n');
    let inToolsSection = false;
    let inMultilineArray = false;
    let currentArrayKey = null;
    let currentArrayContent = [];
    
    for (let i = 0; i < lines.length; i++) {
        let line = lines[i].trim();
        
        // Skip empty lines and comments
        if (!line || line.startsWith('#')) continue;
        
        // Check for [tools] section
        if (line === '[tools]') {
            inToolsSection = true;
            continue;
        }
        
        // Skip if not in tools section
        if (!inToolsSection) continue;
        
        // Handle multiline arrays
        if (inMultilineArray) {
            if (line.endsWith(']')) {
                // End of multiline array
                line = line.replace(/]$/, '');
                if (line.trim()) {
                    currentArrayContent.push(...line.split(',').map(item => 
                        item.trim().replace(/^["']|["']$/g, '')
                    ).filter(item => item));
                }
                
                // Set the complete array
                const [toolName, property] = currentArrayKey.split('.', 2);
                if (!result.tools[toolName]) {
                    result.tools[toolName] = {};
                }
                result.tools[toolName][property] = currentArrayContent;
                
                // Reset multiline tracking
                inMultilineArray = false;
                currentArrayKey = null;
                currentArrayContent = [];
            } else {
                // Continue collecting array items
                if (line) {
                    currentArrayContent.push(...line.split(',').map(item => 
                        item.trim().replace(/^["']|["']$/g, '')
                    ).filter(item => item));
                }
            }
            continue;
        }
        
        // Parse regular key-value pairs
        if (line.includes(' = ')) {
            const [key, ...valueParts] = line.split(' = ');
            const value = valueParts.join(' = ');
            
            if (key.includes('.')) {
                const [toolName, property] = key.split('.', 2);
                
                if (!result.tools[toolName]) {
                    result.tools[toolName] = {};
                }
                
                // Handle different value types
                if (value.startsWith('[') && value.endsWith(']')) {
                    // Single-line array
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
                    // Start of multiline array
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
                    // String value
                    result.tools[toolName][property] = value.slice(1, -1);
                } else {
                    // Fallback - treat as string without quotes
                    result.tools[toolName][property] = value.replace(/^["']|["']$/g, '');
                }
            }
        }
    }
    
    return result;
}

async function loadRegistry() {
    try {
        // Try to load enhanced JSON first, fall back to TOML
        let data;
        try {
            const enhancedResponse = await fetch('registry-enhanced.json');
            if (enhancedResponse.ok) {
                data = await enhancedResponse.json();
                allTools = Object.values(data.tools);
                console.log(`Loaded ${allTools.length} tools from enhanced registry (updated: ${data.last_updated})`);
            } else {
                throw new Error('Enhanced registry not available');
            }
        } catch (enhancedError) {
            console.log('Enhanced registry not found, loading from TOML...');
            const response = await fetch('registry.toml');
            const tomlText = await response.text();
            const parsed = parseRegistryTOML(tomlText);
            
            if (parsed.tools) {
                allTools = Object.entries(parsed.tools).map(([name, data]) => ({
                    name,
                    ...data,
                    github: [],
                    links: []
                }));
                console.log(`Loaded ${allTools.length} tools from TOML`);
            }
        }
        
        filteredTools = [...allTools];
        sortTools();
        updateStats();
        renderTools();
    } catch (error) {
        console.error('Error loading registry:', error);
        document.getElementById('toolsContainer').innerHTML = `
            <div class="no-results">
                <h3>Error Loading Registry</h3>
                <p>Failed to load registry: ${error.message}</p>
            </div>
        `;
    }
}

function extractLinks(tool) {
    const links = [];
    const githubCandidates = [];
    
    if (tool.backends && tool.backends.length > 0) {
        // First pass: collect all GitHub candidates
        tool.backends.forEach(backend => {
            const [type, repo] = backend.split(':', 2);
            
            if (type === 'aqua' || type === 'ubi') {
                // Format: aqua:owner/repo or ubi:owner/repo
                githubCandidates.push({
                    url: `https://github.com/${repo}`,
                    priority: 1, // Highest priority - main project repos
                    source: type
                });
            } else if (type === 'go') {
                // Format: go:github.com/owner/repo/path
                if (repo.startsWith('github.com/')) {
                    const parts = repo.split('/');
                    if (parts.length >= 3) {
                        githubCandidates.push({
                            url: `https://${parts[0]}/${parts[1]}/${parts[2]}`,
                            priority: 2, // Second priority - Go modules
                            source: type
                        });
                    }
                }
            } else if (type === 'asdf') {
                // Format: asdf:owner/repo or asdf:https://...
                if (repo.startsWith('https://github.com/')) {
                    // Check if it's a plugin repo (lower priority)
                    const isPlugin = repo.includes('asdf-') || repo.includes('/asdf/') || repo.includes('mise-plugins/');
                    githubCandidates.push({
                        url: repo,
                        priority: isPlugin ? 4 : 3, // Lower priority for plugins
                        source: type
                    });
                } else if (!repo.includes('mise-plugins/') && repo.includes('/')) {
                    // Assume it's a GitHub repo if it has owner/repo format
                    const isPlugin = repo.includes('asdf-');
                    githubCandidates.push({
                        url: `https://github.com/${repo}`,
                        priority: isPlugin ? 4 : 3, // Lower priority for plugins
                        source: type
                    });
                }
            }
            
            // Add GitLab and NPM links
            if (type === 'asdf' && repo.startsWith('https://gitlab.com/')) {
                if (!links.some(link => link.url === repo)) {
                    links.push({ 
                        type: 'gitlab', 
                        url: repo,
                        label: 'GitLab Repository'
                    });
                }
            } else if (type === 'npm') {
                // Format: npm:package-name
                const url = `https://www.npmjs.com/package/${repo}`;
                if (!links.some(link => link.url === url)) {
                    links.push({ 
                        type: 'npm', 
                        url: url,
                        label: 'NPM Package'
                    });
                }
            }
        });
        
        // Select the best GitHub repository (lowest priority number = highest priority)
        if (githubCandidates.length > 0) {
            // Sort by priority, then remove duplicates
            const uniqueCandidates = githubCandidates.reduce((acc, candidate) => {
                if (!acc.find(c => c.url === candidate.url)) {
                    acc.push(candidate);
                }
                return acc;
            }, []);
            
            uniqueCandidates.sort((a, b) => a.priority - b.priority);
            const bestCandidate = uniqueCandidates[0];
            
            links.unshift({ 
                type: 'github', 
                url: bestCandidate.url,
                label: 'GitHub Repository'
            });
        }
    }
    
    return links;
}

function renderTools() {
    const container = document.getElementById('toolsContainer');
    
    if (filteredTools.length === 0) {
        container.innerHTML = `
            <div class="no-results">
                <h3>No tools found</h3>
                <p>Try adjusting your search criteria</p>
            </div>
        `;
        return;
    }
    
    const html = filteredTools.map(tool => {
        const aliasesHtml = tool.aliases && tool.aliases.length > 0
            ? `<div class="tool-aliases">
                ${tool.aliases.map(alias => `<span class="alias-badge">${escapeHtml(alias)}</span>`).join('')}
               </div>`
            : '';
        
        // GitHub data display
        const githubHtml = tool.github && tool.github.length > 0
            ? `<div class="github-info">
                ${tool.github.filter(g => g.verified).map(github => `
                    <div class="github-repo">
                        <div class="github-stats">
                            ${github.stars ? `<span class="github-stars">⭐ ${formatNumber(github.stars)}</span>` : ''}
                            ${github.language ? `<span class="github-language">${escapeHtml(github.language)}</span>` : ''}
                        </div>
                        ${github.topics && github.topics.length > 0 ? 
                            `<div class="github-topics">
                                ${github.topics.slice(0, 5).map(topic => 
                                    `<span class="github-topic">${escapeHtml(topic)}</span>`
                                ).join('')}
                             </div>` : ''}
                    </div>
                `).join('')}
               </div>`
            : '';
        
        // Use enhanced links if available, otherwise fall back to extracted links
        const links = tool.links && tool.links.length > 0 ? tool.links : extractLinks(tool);
        const linksHtml = links.length > 0
            ? `<div class="tool-links">
                ${links.map(link => {
                    const icon = link.type === 'github' ? '🔗' : 
                                link.type === 'gitlab' ? '🦊' :
                                link.type === 'npm' ? '📦' : 
                                link.type === 'docs' ? '📚' : '🔗';
                    const verified = link.verified !== false;
                    const className = `tool-link ${link.type}${!verified ? ' unverified' : ''}`;
                    const title = link.label || link.type;
                    return `<a href="${escapeHtml(link.url)}" target="_blank" rel="noopener noreferrer" class="${className}" title="${escapeHtml(title)}">${icon} ${escapeHtml(title)}</a>`;
                }).join('')}
               </div>`
            : '';
        
        const backendsHtml = tool.backends && tool.backends.length > 0
            ? `<div class="tool-backends">
                <div class="tool-backends-label">Backends:</div>
                <div class="backends-list">
                    ${tool.backends.map(backend => {
                        const type = backend.split(':')[0];
                        const shortBackend = backend.length > 40 
                            ? backend.substring(0, 37) + '...' 
                            : backend;
                        return `<span class="backend-badge ${type}" title="${escapeHtml(backend)}">${escapeHtml(shortBackend)}</span>`;
                    }).join('')}
                </div>
               </div>`
            : '';
        
        const osHtml = tool.os && tool.os.length > 0
            ? `<div class="tool-os">
                ${tool.os.map(os => `<span class="os-badge">${escapeHtml(os)}</span>`).join('')}
               </div>`
            : '';
        
        return `
            <div class="tool-card">
                <div class="tool-header">
                    <div>
                        <h3 class="tool-name">${escapeHtml(tool.name)}</h3>
                        ${aliasesHtml}
                    </div>
                </div>
                <p class="tool-description">${escapeHtml(tool.description || 'No description available')}</p>
                ${githubHtml}
                ${linksHtml}
                <div class="tool-meta">
                    ${osHtml}
                    ${backendsHtml}
                </div>
            </div>
        `;
    }).join('');
    
    container.innerHTML = html;
}

function formatNumber(num) {
    if (num >= 1000) {
        return (num / 1000).toFixed(1) + 'k';
    }
    return num.toString();
}

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function filterTools(searchTerm) {
    const term = searchTerm.toLowerCase().trim();
    
    if (!term) {
        filteredTools = [...allTools];
    } else {
        filteredTools = allTools.filter(tool => {
            const nameMatch = tool.name.toLowerCase().includes(term);
            const descriptionMatch = tool.description && tool.description.toLowerCase().includes(term);
            const aliasMatch = tool.aliases && tool.aliases.some(alias => 
                alias.toLowerCase().includes(term)
            );
            
            return nameMatch || descriptionMatch || aliasMatch;
        });
    }
    
    sortTools();
    updateStats();
    renderTools();
}

function sortTools() {
    const sortValue = document.getElementById('sort').value;
    
    switch (sortValue) {
        case 'alpha':
            filteredTools.sort((a, b) => a.name.localeCompare(b.name));
            break;
        case 'alpha-reverse':
            filteredTools.sort((a, b) => b.name.localeCompare(a.name));
            break;
        case 'stars':
            filteredTools.sort((a, b) => {
                const starsA = getMaxStars(a);
                const starsB = getMaxStars(b);
                return starsB - starsA; // High to low
            });
            break;
        case 'stars-reverse':
            filteredTools.sort((a, b) => {
                const starsA = getMaxStars(a);
                const starsB = getMaxStars(b);
                return starsA - starsB; // Low to high
            });
            break;
    }
}

function getMaxStars(tool) {
    if (!tool.github || tool.github.length === 0) return 0;
    return Math.max(...tool.github.map(gh => gh.stars || 0));
}

function updateStats() {
    const toolCount = document.getElementById('toolCount');
    const filteredCount = document.getElementById('filteredCount');
    
    toolCount.textContent = `Total tools: ${allTools.length}`;
    
    if (filteredTools.length !== allTools.length) {
        filteredCount.textContent = `Showing: ${filteredTools.length}`;
    } else {
        filteredCount.textContent = '';
    }
}

let searchTimeout;
document.getElementById('search').addEventListener('input', (e) => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => {
        filterTools(e.target.value);
    }, 300);
});

document.getElementById('sort').addEventListener('change', (e) => {
    localStorage.setItem('mise-registry-sort', e.target.value);
    sortTools();
    renderTools();
});

// Load saved sort preference
const savedSort = localStorage.getItem('mise-registry-sort');
if (savedSort) {
    document.getElementById('sort').value = savedSort;
}

loadRegistry();
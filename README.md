# Mise Tool Registry Frontend

A modern web frontend for browsing the Mise tool registry with enhanced GitHub data including star counts, topics, and verified URLs.

## Features

- 🔍 **Search & Filter**: Search tools by name, description, or aliases
- 📊 **Sort Options**: Alphabetical sorting (A-Z, Z-A)  
- ⭐ **GitHub Integration**: Star counts, topics, and repository verification
- 🔗 **Smart Links**: Auto-extracted links to GitHub, docs, NPM packages
- 📱 **Responsive**: Works on desktop and mobile
- 🎨 **Modern UI**: Clean, accessible design

## Quick Start

1. **Serve the frontend**:
   ```bash
   npm run serve
   # Opens on http://localhost:8080
   ```

## Update GitHub Data

The offline update script fetches fresh GitHub data for tools. You can update all tools at once or process them in batches by prefix.

### Batch Updates by Prefix (Recommended)

Process tools in small batches to avoid rate limits and allow incremental progress:

```bash
# Analyze tool distribution first
npm run analyze

# Get suggested batch commands
npm run batch-commands-token  # with token
npm run batch-commands       # without token

# Update tools starting with specific letters
node update-registry.js --prefix=act    # Updates: act, action-validator, actionlint
node update-registry.js --prefix=g      # All tools starting with 'g'
node update-registry.js --prefix=ku     # All tools starting with 'ku'

# Caching & regeneration options
node update-registry.js --prefix=act --regenerate    # Force update even if cached
node update-registry.js --prefix=g --max-age=2d      # Update tools older than 2 days
node update-registry.js --max-age=1w                 # Update all tools older than 1 week
```

**With GitHub Token:**
```bash
export GITHUB_TOKEN="your_github_token"
node update-registry.js --prefix=a --token
```

### Full Updates

Update all tools at once (use prefix method instead for better control):

```bash
# Without token (60 requests/hour - very slow)
npm run update

# With token (5000 requests/hour)
export GITHUB_TOKEN="your_github_token"
npm run update-with-token
```

### GitHub Token Setup
1. Go to GitHub → Settings → Developer Settings → Personal Access Tokens
2. Create token with `public_repo` scope
3. Export as environment variable

### Batch Processing Features

- **Automatic merging**: Prefix updates automatically merge with existing data
- **Progress tracking**: See exactly which tools are being processed
- **Smart distribution**: Use `npm run analyze` to see tool distribution by prefix
- **Incremental updates**: Update a few tools at a time, build up complete dataset
- **Resume capability**: If interrupted, just continue with remaining prefixes
- **Smart caching**: Skips recently updated tools (default: 7 days)
- **Force regeneration**: Use `--regenerate` to update cached tools
- **Flexible aging**: Use `--max-age=2d` to control cache duration

### Example Workflow

```bash
# 1. Analyze tool distribution
npm run analyze

# 2. Get batch commands (shows estimated time)
npm run batch-commands-token

# 3. Process in small batches
export GITHUB_TOKEN="your_token"
node update-registry.js --prefix=act    # 3 tools
node update-registry.js --prefix=age    # 5 tools  
node update-registry.js --prefix=g      # 71 tools (might want to split further)

# 4. Check progress
ls -la registry-enhanced.json
```

### Output
The script creates `registry-enhanced.json` with:
- ⭐ Star counts
- 🏷️ GitHub topics/tags
- ✅ URL validation
- 📅 Last updated timestamps
- 🔗 Verified repository links
- 🔄 Incremental updates (merges with existing data)

## Data Structure

```json
{
  "tools": {
    "tool-name": {
      "name": "tool-name",
      "description": "Tool description",
      "backends": ["aqua:owner/repo"],
      "github": [
        {
          "url": "https://github.com/owner/repo",
          "stars": 1234,
          "topics": ["cli", "rust"],
          "last_updated": "2024-01-15",
          "verified": true
        }
      ],
      "links": [
        {"type": "github", "url": "...", "verified": true},
        {"type": "docs", "url": "...", "verified": true}
      ]
    }
  }
}
```

## Development

The update script:
- Parses `registry.toml` 
- Extracts GitHub repositories from backends
- Fetches GitHub API data (stars, topics, etc.)
- Validates all extracted URLs
- Outputs enhanced data as JSON

Rate limiting is built-in to respect GitHub API limits.
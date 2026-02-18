# Oldscape MCP

Shared OSRS team wiki — accessible from Claude Code.

## Setup

1. Deploy to Vercel
2. Connect Turso via Vercel integration
3. Set env vars: `TURSO_URL`, `TURSO_AUTH_TOKEN`

## Claude Code Config

Add to your project's `.mcp.json`:

```json
{
  "mcpServers": {
    "oldscape": {
      "url": "https://your-deployment.vercel.app/api/mcp"
    }
  }
}
```

## Tools

| Tool | Description |
|------|-------------|
| `get_character` | Get character stats, gear, and notes |
| `update_character` | Update character profile |
| `pull_stats` | Fetch live hiscores from Jagex API |
| `list_quests` | List all quest plans |
| `get_quest` | Get quest details |
| `upsert_quest` | Add or update a quest plan |
| `list_goals` | List shared goals |
| `add_goal` | Add a new goal |
| `complete_goal` | Mark a goal done |
| `get_guide` | Get a skill/reference guide |
| `upsert_guide` | Add or update a guide |
| `search` | Search across all content |

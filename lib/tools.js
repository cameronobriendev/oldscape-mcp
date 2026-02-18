import { z } from 'zod';
import * as db from './db.js';
import { fetchHiscores, formatStats } from './hiscores.js';

export function registerTools(server) {

  // ── Characters ──

  server.tool(
    'get_character',
    'Get a character profile with stats, gear, and notes',
    { name: z.string().describe('Character name (e.g. legolas, kacy)') },
    async ({ name }) => {
      const char = await db.getCharacter(name.toLowerCase());
      if (!char) {
        return { content: [{ type: 'text', text: `Character "${name}" not found.` }] };
      }
      const stats = typeof char.stats === 'string' ? JSON.parse(char.stats) : char.stats;
      let text = `# ${char.name} (RSN: ${char.rsn})\n\n`;
      text += `## Stats\n`;
      for (const [skill, data] of Object.entries(stats)) {
        if (skill === 'total_level' || skill === 'total_xp') continue;
        if (typeof data === 'object' && data.level > 1) {
          text += `- ${skill}: ${data.level}\n`;
        }
      }
      if (stats.total_level) text += `\nTotal Level: ${stats.total_level}\n`;
      if (char.gear) text += `\n## Gear\n${char.gear}\n`;
      if (char.notes) text += `\n## Notes\n${char.notes}\n`;
      text += `\nLast updated: ${char.updated_at}`;
      return { content: [{ type: 'text', text }] };
    }
  );

  server.tool(
    'update_character',
    'Update a character profile (stats, gear, notes). Creates the character if it does not exist.',
    {
      name: z.string().describe('Character name'),
      rsn: z.string().optional().describe('RuneScape name (e.g. WitchDaddy42)'),
      gear: z.string().optional().describe('Current gear description'),
      notes: z.string().optional().describe('Freeform notes about the character'),
    },
    async ({ name, rsn, gear, notes }) => {
      const result = await db.upsertCharacter(name.toLowerCase(), { rsn, gear, notes });
      return { content: [{ type: 'text', text: `Updated character "${result.name}".` }] };
    }
  );

  server.tool(
    'pull_stats',
    'Fetch live stats from OSRS Hiscores API and update the character. Player must have logged out recently for fresh data.',
    {
      name: z.string().describe('Character name in our wiki'),
      rsn: z.string().describe('RuneScape name to look up (e.g. WitchDaddy42)'),
    },
    async ({ name, rsn }) => {
      const stats = await fetchHiscores(rsn);
      await db.upsertCharacter(name.toLowerCase(), { rsn, stats });
      const text = `# ${name} — Live Stats (${rsn})\n\n${formatStats(stats)}\n\nNote: Hiscores update on logout. If data looks stale, the player needs to log out first.`;
      return { content: [{ type: 'text', text }] };
    }
  );

  // ── Quests ──

  server.tool(
    'list_quests',
    'List all quest plans, optionally filtered by status or assigned player',
    {
      status: z.string().optional().describe('Filter by status: planned, in_progress, completed'),
      assigned_to: z.string().optional().describe('Filter by assigned character name'),
    },
    async ({ status, assigned_to }) => {
      const quests = await db.listQuests({ status, assigned_to });
      if (quests.length === 0) {
        return { content: [{ type: 'text', text: 'No quests found.' }] };
      }
      let text = '# Quest Plans\n\n';
      for (const q of quests) {
        const assignee = q.assigned_to ? ` (${q.assigned_to})` : '';
        const prio = q.priority > 0 ? ` [Priority: ${q.priority}]` : '';
        text += `- **${q.name}** — ${q.status}${assignee}${prio}\n`;
      }
      return { content: [{ type: 'text', text }] };
    }
  );

  server.tool(
    'get_quest',
    'Get full details of a specific quest plan',
    { name: z.string().describe('Quest name (e.g. The Corsair Curse)') },
    async ({ name }) => {
      const quest = await db.getQuest(name);
      if (!quest) {
        return { content: [{ type: 'text', text: `Quest "${name}" not found.` }] };
      }
      let text = `# ${quest.name}\n\n`;
      text += `**Status:** ${quest.status}\n`;
      if (quest.assigned_to) text += `**Assigned to:** ${quest.assigned_to}\n`;
      if (quest.priority > 0) text += `**Priority:** ${quest.priority}\n`;
      if (quest.requirements) text += `\n## Requirements\n${quest.requirements}\n`;
      if (quest.plan) text += `\n## Plan\n${quest.plan}\n`;
      if (quest.rewards) text += `\n## Rewards\n${quest.rewards}\n`;
      text += `\nLast updated: ${quest.updated_at}`;
      return { content: [{ type: 'text', text }] };
    }
  );

  server.tool(
    'upsert_quest',
    'Add or update a quest plan',
    {
      name: z.string().describe('Quest name'),
      status: z.string().optional().describe('planned, in_progress, or completed'),
      assigned_to: z.string().optional().describe('Character name assigned to this quest'),
      requirements: z.string().optional().describe('Prerequisites and level requirements'),
      plan: z.string().optional().describe('Walkthrough and strategy notes'),
      rewards: z.string().optional().describe('Quest rewards'),
      priority: z.number().optional().describe('Priority (higher = more important)'),
    },
    async ({ name, status, assigned_to, requirements, plan, rewards, priority }) => {
      const result = await db.upsertQuest(name, { status, assigned_to, requirements, plan, rewards, priority });
      return { content: [{ type: 'text', text: `Quest "${result.name}" saved (status: ${result.status}).` }] };
    }
  );

  // ── Goals ──

  server.tool(
    'list_goals',
    'List all shared goals, optionally filtered by status',
    {
      status: z.string().optional().describe('Filter: active or completed'),
    },
    async ({ status }) => {
      const goals = await db.listGoals(status);
      if (goals.length === 0) {
        return { content: [{ type: 'text', text: 'No goals found.' }] };
      }
      let text = '# Shared Goals\n\n';
      for (const g of goals) {
        const check = g.status === 'completed' ? '[x]' : '[ ]';
        const assignee = g.assigned_to ? ` (${g.assigned_to})` : '';
        text += `- ${check} **#${g.id}** ${g.description}${assignee}\n`;
        if (g.notes) text += `  _${g.notes}_\n`;
      }
      return { content: [{ type: 'text', text }] };
    }
  );

  server.tool(
    'add_goal',
    'Add a new shared goal',
    {
      description: z.string().describe('What needs to be done'),
      assigned_to: z.string().optional().describe('Character name responsible'),
      notes: z.string().optional().describe('Additional context'),
    },
    async ({ description, assigned_to, notes }) => {
      const goal = await db.addGoal(description, assigned_to, notes);
      return { content: [{ type: 'text', text: `Goal #${goal.id} created: "${goal.description}"` }] };
    }
  );

  server.tool(
    'complete_goal',
    'Mark a goal as completed',
    { id: z.number().describe('Goal ID number') },
    async ({ id }) => {
      const goal = await db.completeGoal(id);
      if (!goal) {
        return { content: [{ type: 'text', text: `Goal #${id} not found.` }] };
      }
      return { content: [{ type: 'text', text: `Goal #${id} completed: "${goal.description}"` }] };
    }
  );

  // ── Guides ──

  server.tool(
    'get_guide',
    'Get a skill or reference guide',
    { slug: z.string().describe('Guide slug (e.g. woodcutting, potions, ogress-warriors)') },
    async ({ slug }) => {
      const guide = await db.getGuide(slug);
      if (!guide) {
        return { content: [{ type: 'text', text: `Guide "${slug}" not found.` }] };
      }
      return { content: [{ type: 'text', text: `# ${guide.title}\n\n${guide.content}\n\nLast updated: ${guide.updated_at}` }] };
    }
  );

  server.tool(
    'upsert_guide',
    'Add or update a skill or reference guide',
    {
      slug: z.string().describe('URL-friendly identifier (e.g. woodcutting, potions)'),
      title: z.string().describe('Guide title'),
      content: z.string().describe('Full guide content in markdown'),
    },
    async ({ slug, title, content }) => {
      await db.upsertGuide(slug, title, content);
      return { content: [{ type: 'text', text: `Guide "${title}" saved.` }] };
    }
  );

  // ── Search ──

  server.tool(
    'search',
    'Search across all characters, quests, goals, and guides',
    { query: z.string().describe('Search term') },
    async ({ query }) => {
      const results = await db.searchAll(query);
      let text = `# Search: "${query}"\n\n`;
      let found = false;

      if (results.characters.length > 0) {
        found = true;
        text += `## Characters\n`;
        for (const c of results.characters) text += `- ${c.name} (${c.rsn})\n`;
        text += '\n';
      }
      if (results.quests.length > 0) {
        found = true;
        text += `## Quests\n`;
        for (const q of results.quests) text += `- ${q.name} — ${q.status}\n`;
        text += '\n';
      }
      if (results.goals.length > 0) {
        found = true;
        text += `## Goals\n`;
        for (const g of results.goals) text += `- #${g.id}: ${g.description} (${g.status})\n`;
        text += '\n';
      }
      if (results.guides.length > 0) {
        found = true;
        text += `## Guides\n`;
        for (const g of results.guides) text += `- ${g.title} (${g.slug})\n`;
        text += '\n';
      }
      if (!found) text += 'No results found.\n';
      return { content: [{ type: 'text', text }] };
    }
  );
}

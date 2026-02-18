import { z } from 'zod';
import * as db from './db.js';
import { fetchHiscores, formatStats } from './hiscores.js';
import { searchWiki, fetchPage } from './wiki.js';

export function registerTools(server, player) {

  // Player-to-RSN mapping for quick pull_stats
  const PLAYER_RSN = { legolas: 'WitchDaddy42', kacy: 'MamaWitch42' };

  // ── Characters ──

  server.tool(
    'get_character',
    'Get a character profile with stats, gear, and notes. Defaults to your own character if no name given.',
    { name: z.string().optional().describe('Character name (e.g. legolas, kacy). Omit for your own.') },
    async ({ name }) => {
      const target = (name || player || '').toLowerCase();
      if (!target) {
        return { content: [{ type: 'text', text: 'No character name provided and no player configured.' }] };
      }
      const char = await db.getCharacter(target);
      if (!char) {
        return { content: [{ type: 'text', text: `Character "${target}" not found.` }] };
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
    'Update a character profile (stats, gear, notes). Defaults to your own character if no name given.',
    {
      name: z.string().optional().describe('Character name. Omit for your own.'),
      rsn: z.string().optional().describe('RuneScape name (e.g. WitchDaddy42)'),
      gear: z.string().optional().describe('Current gear description'),
      notes: z.string().optional().describe('Freeform notes about the character'),
    },
    async ({ name, rsn, gear, notes }) => {
      const target = (name || player || '').toLowerCase();
      if (!target) {
        return { content: [{ type: 'text', text: 'No character name provided and no player configured.' }] };
      }
      const result = await db.upsertCharacter(target, { rsn, gear, notes });
      return { content: [{ type: 'text', text: `Updated character "${result.name}".` }] };
    }
  );

  server.tool(
    'pull_stats',
    'Fetch live stats from OSRS Hiscores API and update the character. Defaults to your own character.',
    {
      name: z.string().optional().describe('Character name in our wiki. Omit for your own.'),
      rsn: z.string().optional().describe('RuneScape name. Omit to use the known RSN for the character.'),
    },
    async ({ name, rsn }) => {
      const target = (name || player || '').toLowerCase();
      if (!target) {
        return { content: [{ type: 'text', text: 'No character name provided and no player configured.' }] };
      }
      const lookupRsn = rsn || PLAYER_RSN[target];
      if (!lookupRsn) {
        return { content: [{ type: 'text', text: `No RSN provided and none on file for "${target}".` }] };
      }
      const stats = await fetchHiscores(lookupRsn);
      await db.upsertCharacter(target, { rsn: lookupRsn, stats });
      const text = `# ${target} — Live Stats (${lookupRsn})\n\n${formatStats(stats)}\n\nNote: Hiscores update on logout. If data looks stale, the player needs to log out first.`;
      return { content: [{ type: 'text', text }] };
    }
  );

  // ── Quests ──

  server.tool(
    'list_quests',
    'List all quest plans. Shows your quests first by default, then shared/other quests.',
    {
      status: z.string().optional().describe('Filter by status: planned, in_progress, completed'),
      assigned_to: z.string().optional().describe('Filter by assigned character name. Omit to see all (yours first).'),
      mine_only: z.boolean().optional().describe('If true, only show quests assigned to you'),
    },
    async ({ status, assigned_to, mine_only }) => {
      const filterPlayer = assigned_to || (mine_only ? player : null);
      const quests = await db.listQuests({ status, assigned_to: filterPlayer });

      // If no filter, get all quests and sort: player's first, then shared, then other
      let allQuests = quests;
      if (!filterPlayer && !status) {
        allQuests = await db.listQuests({});
      }

      if (allQuests.length === 0) {
        return { content: [{ type: 'text', text: 'No quests found.' }] };
      }

      // Sort: yours first, then unassigned, then other player's
      if (player) {
        allQuests.sort((a, b) => {
          const aOwn = a.assigned_to === player ? 0 : (a.assigned_to ? 2 : 1);
          const bOwn = b.assigned_to === player ? 0 : (b.assigned_to ? 2 : 1);
          if (aOwn !== bOwn) return aOwn - bOwn;
          return (b.priority || 0) - (a.priority || 0);
        });
      }

      let text = '# Quest Plans\n\n';
      for (const q of allQuests) {
        const assignee = q.assigned_to ? ` (${q.assigned_to})` : ' (shared)';
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
    'List team goals. Shows all goals — yours are marked. Use mine_only to filter.',
    {
      status: z.string().optional().describe('Filter: active or completed'),
      mine_only: z.boolean().optional().describe('If true, only show goals assigned to you'),
    },
    async ({ status, mine_only }) => {
      const goals = await db.listGoals(status);
      let filtered = goals;
      if (mine_only && player) {
        filtered = goals.filter(g => g.assigned_to === player);
      }
      if (filtered.length === 0) {
        return { content: [{ type: 'text', text: 'No goals found.' }] };
      }
      let text = '# Team Goals\n\n';
      for (const g of filtered) {
        const check = g.status === 'completed' ? '[x]' : '[ ]';
        const own = (player && g.assigned_to === player) ? ' ★' : '';
        const assignee = g.assigned_to ? ` (${g.assigned_to})` : ' (team)';
        text += `- ${check} **#${g.id}** ${g.description}${assignee}${own}\n`;
        if (g.notes) text += `  _${g.notes}_\n`;
      }
      return { content: [{ type: 'text', text }] };
    }
  );

  server.tool(
    'add_goal',
    'Add a new goal. Defaults to assigning to you unless specified.',
    {
      description: z.string().describe('What needs to be done'),
      assigned_to: z.string().optional().describe('Character name responsible. Omit to assign to yourself.'),
      notes: z.string().optional().describe('Additional context'),
    },
    async ({ description, assigned_to, notes }) => {
      const assignee = assigned_to || player || null;
      const goal = await db.addGoal(description, assignee, notes);
      return { content: [{ type: 'text', text: `Goal #${goal.id} created: "${goal.description}" (assigned to ${goal.assigned_to || 'team'})` }] };
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

  // ── Identity ──

  server.tool(
    'whoami',
    'Show which player this MCP connection is configured as',
    {},
    async () => {
      if (!player) {
        return { content: [{ type: 'text', text: 'No player configured. Add ?player=legolas or ?player=kacy to the MCP URL.' }] };
      }
      const char = await db.getCharacter(player);
      const rsn = char ? char.rsn : 'unknown';
      return { content: [{ type: 'text', text: `Connected as: **${player}** (RSN: ${rsn})` }] };
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

  // ── Wiki (cached proxy — saves context) ──

  server.tool(
    'wiki_lookup',
    'Search the OSRS Wiki. Returns titles + short snippets only (not full pages). Use wiki_page to read a specific page.',
    { query: z.string().describe('What to search for (e.g. "Corsair Cove fishing", "maple shortbow")') },
    async ({ query }) => {
      const results = await searchWiki(query);
      if (results.length === 0) {
        return { content: [{ type: 'text', text: `No wiki results for "${query}".` }] };
      }
      let text = `# Wiki Search: "${query}"\n\n`;
      for (const r of results) {
        text += `- **${r.title}** — ${r.snippet}\n`;
      }
      text += `\nUse wiki_page to fetch and cache a full page. Use wiki_section to read a specific section.`;
      return { content: [{ type: 'text', text }] };
    }
  );

  server.tool(
    'wiki_page',
    'Fetch an OSRS Wiki page, cache it in the DB, and return ONLY the section headings (not full content). Use wiki_section to read specific sections.',
    { title: z.string().describe('Exact wiki page title (e.g. "The Corsair Curse", "Maple shortbow")') },
    async ({ title }) => {
      // Check cache first
      let cached = await db.getCachedPage(title);
      if (!cached) {
        const sections = await fetchPage(title);
        cached = await db.cachePage(title, sections);
      }

      let text = `# ${title}\n\nCached ${cached.sections.length} sections:\n\n`;
      for (let i = 0; i < cached.sections.length; i++) {
        const s = cached.sections[i];
        const preview = s.content.substring(0, 80).replace(/\n/g, ' ');
        text += `${i + 1}. **${s.heading}** — ${preview}...\n`;
      }
      text += `\nUse wiki_section to read a specific section by name or number.`;
      return { content: [{ type: 'text', text }] };
    }
  );

  server.tool(
    'wiki_section',
    'Read a specific section from a cached wiki page. Much smaller than loading the full page.',
    {
      title: z.string().describe('Wiki page title (must have been fetched with wiki_page first)'),
      section: z.string().describe('Section heading name or number (e.g. "Requirements" or "3")'),
    },
    async ({ title, section }) => {
      const cached = await db.getCachedPage(title);
      if (!cached) {
        return { content: [{ type: 'text', text: `Page "${title}" not cached. Use wiki_page first.` }] };
      }

      // Find by number or heading name
      let found = null;
      const sectionNum = parseInt(section, 10);
      if (!isNaN(sectionNum) && sectionNum >= 1 && sectionNum <= cached.sections.length) {
        found = cached.sections[sectionNum - 1];
      } else {
        found = cached.sections.find(s =>
          s.heading.toLowerCase().includes(section.toLowerCase())
        );
      }

      if (!found) {
        const headings = cached.sections.map((s, i) => `${i + 1}. ${s.heading}`).join('\n');
        return { content: [{ type: 'text', text: `Section "${section}" not found in "${title}".\n\nAvailable sections:\n${headings}` }] };
      }

      return { content: [{ type: 'text', text: `# ${title} — ${found.heading}\n\n${found.content}` }] };
    }
  );

  server.tool(
    'wiki_search_cached',
    'Search within already-cached wiki pages for a keyword. Only searches pages previously fetched with wiki_page.',
    { keyword: z.string().describe('Keyword to search for in cached pages') },
    async ({ keyword }) => {
      const pages = await db.listCachedPages();
      if (pages.length === 0) {
        return { content: [{ type: 'text', text: 'No cached wiki pages. Use wiki_page to fetch some first.' }] };
      }

      const results = [];
      const term = keyword.toLowerCase();
      for (const page of pages) {
        const cached = await db.getCachedPage(page.page_title);
        if (!cached) continue;
        for (const section of cached.sections) {
          if (section.content.toLowerCase().includes(term) || section.heading.toLowerCase().includes(term)) {
            const idx = section.content.toLowerCase().indexOf(term);
            const start = Math.max(0, idx - 40);
            const end = Math.min(section.content.length, idx + keyword.length + 60);
            const snippet = section.content.substring(start, end).replace(/\n/g, ' ');
            results.push({ page: page.page_title, section: section.heading, snippet });
          }
        }
      }

      if (results.length === 0) {
        return { content: [{ type: 'text', text: `No matches for "${keyword}" in cached pages.` }] };
      }

      let text = `# Cached Wiki Search: "${keyword}"\n\n`;
      for (const r of results) {
        text += `- **${r.page}** > ${r.section}: ...${r.snippet}...\n`;
      }
      return { content: [{ type: 'text', text }] };
    }
  );
}

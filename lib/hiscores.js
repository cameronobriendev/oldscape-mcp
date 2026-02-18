const API_BASE = 'https://secure.runescape.com/m=hiscore_oldschool/index_lite.json?player=';

export async function fetchHiscores(rsn) {
  const response = await fetch(`${API_BASE}${encodeURIComponent(rsn)}`);
  if (!response.ok) {
    throw new Error(`Hiscores API returned ${response.status} for player "${rsn}"`);
  }
  const data = await response.json();

  if (!data.skills) {
    throw new Error(`No skill data returned for player "${rsn}"`);
  }

  const stats = {};
  for (const skill of data.skills) {
    if (skill.name === 'Overall') {
      stats.total_level = skill.level;
      stats.total_xp = skill.xp;
    } else {
      const key = skill.name.toLowerCase();
      stats[key] = { level: skill.level, xp: skill.xp };
    }
  }

  return stats;
}

export function formatStats(stats) {
  const lines = [];
  for (const [key, value] of Object.entries(stats)) {
    if (key === 'total_level' || key === 'total_xp') continue;
    if (typeof value === 'object' && value.level > 1) {
      const name = key.charAt(0).toUpperCase() + key.slice(1);
      lines.push(`${name}: ${value.level} (${value.xp.toLocaleString()} XP)`);
    }
  }
  if (stats.total_level) {
    lines.push(`\nTotal Level: ${stats.total_level} (${stats.total_xp.toLocaleString()} XP)`);
  }
  return lines.join('\n');
}

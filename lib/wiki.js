const WIKI_API = 'https://oldschool.runescape.wiki/api.php';
const USER_AGENT = 'oldscape-mcp/1.0 (shared team wiki)';

// Search the OSRS wiki and return titles + snippets
export async function searchWiki(query, limit = 10) {
  const params = new URLSearchParams({
    action: 'query',
    list: 'search',
    srsearch: query,
    srlimit: String(limit),
    srprop: 'snippet',
    format: 'json',
  });
  const res = await fetch(`${WIKI_API}?${params}`, {
    headers: { 'User-Agent': USER_AGENT },
  });
  if (!res.ok) throw new Error(`Wiki search failed: ${res.status}`);
  const data = await res.json();
  return (data.query?.search || []).map(r => ({
    title: r.title,
    snippet: r.snippet.replace(/<[^>]+>/g, '').substring(0, 120),
  }));
}

// Fetch a full wiki page as wikitext, split into sections
export async function fetchPage(pageTitle) {
  const params = new URLSearchParams({
    action: 'parse',
    page: pageTitle,
    prop: 'wikitext',
    format: 'json',
  });
  const res = await fetch(`${WIKI_API}?${params}`, {
    headers: { 'User-Agent': USER_AGENT },
  });
  if (!res.ok) throw new Error(`Wiki fetch failed: ${res.status}`);
  const data = await res.json();

  if (data.error) throw new Error(data.error.info);

  const wikitext = data.parse?.wikitext?.['*'] || '';
  return parseIntoSections(pageTitle, wikitext);
}

// Split wikitext into named sections with cleaned content
function parseIntoSections(title, wikitext) {
  const sections = [];
  const lines = wikitext.split('\n');
  let currentHeading = 'Introduction';
  let currentContent = [];

  for (const line of lines) {
    const headingMatch = line.match(/^(={2,})\s*(.+?)\s*\1$/);
    if (headingMatch) {
      // Save previous section
      if (currentContent.length > 0) {
        sections.push({
          heading: currentHeading,
          content: cleanWikitext(currentContent.join('\n')),
        });
      }
      currentHeading = headingMatch[2];
      currentContent = [];
    } else {
      currentContent.push(line);
    }
  }

  // Save last section
  if (currentContent.length > 0) {
    sections.push({
      heading: currentHeading,
      content: cleanWikitext(currentContent.join('\n')),
    });
  }

  return sections;
}

// Strip wiki markup into readable plain text
function cleanWikitext(text) {
  return text
    // Remove templates like {{template|arg}} — keep simple ones
    .replace(/\{\{[Cc]ite[^}]*\}\}/g, '')
    .replace(/\{\{[Mm]ain\|([^}]+)\}\}/g, 'See: $1')
    .replace(/\{\{[Ss]ic\}\}/g, '')
    // Convert links [[Page|display]] → display, [[Page]] → Page
    .replace(/\[\[(?:[^|\]]*\|)?([^\]]+)\]\]/g, '$1')
    // Remove external links [url text] → text
    .replace(/\[https?:\/\/[^\s\]]+ ([^\]]+)\]/g, '$1')
    .replace(/\[https?:\/\/[^\]]+\]/g, '')
    // Remove file/image references
    .replace(/\[\[File:[^\]]+\]\]/gi, '')
    .replace(/\[\[Image:[^\]]+\]\]/gi, '')
    // Remove HTML tags
    .replace(/<ref[^>]*>.*?<\/ref>/gs, '')
    .replace(/<ref[^>]*\/>/g, '')
    .replace(/<[^>]+>/g, '')
    // Clean formatting
    .replace(/'{2,3}/g, '')
    // Remove categories
    .replace(/\[\[Category:[^\]]+\]\]/gi, '')
    // Collapse whitespace
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

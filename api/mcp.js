import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { registerTools } from '../lib/tools.js';

function createServer() {
  const server = new McpServer({
    name: 'oldscape',
    version: '1.0.0',
  });
  registerTools(server);
  return server;
}

export default async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept, mcp-session-id, mcp-protocol-version');

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  if (!['GET', 'POST', 'DELETE'].includes(req.method)) {
    res.status(405).json({ error: 'Method Not Allowed' });
    return;
  }

  try {
    const server = createServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined, // Stateless
    });

    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    console.error('MCP Error:', err);
    if (!res.headersSent) {
      res.status(500).json({ error: err.message });
    }
  }
}

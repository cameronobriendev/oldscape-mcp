import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { registerTools } from '../lib/tools.js';

function createServer() {
  const server = new McpServer({
    name: 'oldscape',
    version: '1.0.0',
  });
  registerTools(server);
  return server;
}

export default async function handler(request) {
  // Handle CORS preflight
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, mcp-session-id, mcp-protocol-version',
      },
    });
  }

  // Only allow POST (tool calls), GET (SSE stream), DELETE (session close)
  if (!['GET', 'POST', 'DELETE'].includes(request.method)) {
    return new Response('Method Not Allowed', { status: 405 });
  }

  const server = createServer();
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // Stateless — ideal for serverless
  });

  await server.connect(transport);

  const response = await transport.handleRequest(request);

  // Add CORS headers to the response
  const headers = new Headers(response.headers);
  headers.set('Access-Control-Allow-Origin', '*');

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

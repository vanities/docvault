import { connect } from 'node:net';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { RESEARCH_CHAT_TOOLS, chatToolResult } from '../chat-tool-definitions.js';

const socketPath = process.env.DOCVAULT_TOOL_SOCKET;
if (!socketPath) throw new Error('Missing DocVault tool bridge socket');
const server = new McpServer({ name: 'docvault-research', version: '1.0.0' });
for (const definition of RESEARCH_CHAT_TOOLS) {
  server.registerTool(
    definition.name,
    {
      description: definition.description,
      inputSchema: definition.inputSchema,
      annotations: {
        readOnlyHint: definition.readOnly,
        destructiveHint: false,
        openWorldHint: !['run_calculation', 'save_research', 'get_research_run'].includes(
          definition.name
        ),
      },
    },
    async (input) => {
      try {
        return await new Promise<ReturnType<typeof chatToolResult>>((resolve, reject) => {
          const socket = connect(socketPath);
          let buffer = '';
          socket.setEncoding('utf8');
          socket.setTimeout(25_000, () => socket.destroy(new Error('Tool bridge timed out')));
          socket.on('connect', () =>
            socket.write(JSON.stringify({ name: definition.name, input }) + '\n')
          );
          socket.on('error', reject);
          socket.on('data', (chunk: string) => {
            buffer += chunk;
            if (buffer.length > 600_000) {
              socket.destroy(new Error('Tool response exceeds limit'));
              return;
            }
            if (!buffer.includes('\n')) return;
            try {
              resolve(JSON.parse(buffer.split('\n')[0]!) as ReturnType<typeof chatToolResult>);
            } catch (error) {
              reject(error);
            }
            socket.destroy();
          });
          socket.on('end', () => {
            if (!buffer.includes('\n')) reject(new Error('Tool bridge closed'));
          });
        });
      } catch (error) {
        return chatToolResult(
          { error: error instanceof Error ? error.message : 'Tool failed' },
          true
        );
      }
    }
  );
}
await server.connect(new StdioServerTransport());

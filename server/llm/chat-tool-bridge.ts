// Codex launches a stdio MCP helper, but all tool execution stays in the main
// DocVault process: background research survives a chat turn, and store locks
// remain shared with HTTP routes and scheduled jobs.
import { createServer } from 'node:net';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { callChatTool, chatToolResult, type ExecutableChatTool } from '../chat-tool-definitions.js';

export async function openChatToolBridge(tools: ExecutableChatTool[], signal?: AbortSignal) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'docvault-tools-'));
  const socketPath = path.join(directory, 'mcp.sock');
  const connections = new Set<import('node:net').Socket>();
  const server = createServer((socket) => {
    connections.add(socket);
    socket.setEncoding('utf8');
    socket.setTimeout(30_000, () => socket.destroy());
    socket.on('error', () => {});
    socket.on('close', () => connections.delete(socket));
    let buffer = '',
      handled = false;
    socket.on('data', (chunk: string) => {
      if (handled) return;
      buffer += chunk;
      if (buffer.length > 600_000) {
        socket.destroy();
        return;
      }
      if (!buffer.includes('\n')) return;
      handled = true;
      void (async () => {
        try {
          const request = JSON.parse(buffer.split('\n')[0]!) as { name: string; input: unknown };
          const result = await callChatTool(tools, request.name, request.input, signal);
          socket.end(JSON.stringify(chatToolResult(result)) + '\n');
        } catch (error) {
          socket.end(
            JSON.stringify(
              chatToolResult(
                { error: error instanceof Error ? error.message : 'Tool failed' },
                true
              )
            ) + '\n'
          );
        }
      })();
    });
  });
  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(socketPath, resolve);
    });
    await fs.chmod(socketPath, 0o600);
  } catch (error) {
    server.close();
    await fs.rm(directory, { recursive: true, force: true });
    throw error;
  }
  return {
    socketPath,
    close: async () => {
      for (const connection of connections) connection.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await fs.rm(directory, { recursive: true, force: true });
    },
  };
}

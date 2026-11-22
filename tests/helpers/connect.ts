import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { Server } from "@modelcontextprotocol/sdk/server/index.js";

/** Connect an in-memory MCP client to the server instance src/index.ts exports. */
export async function connectInMemory(server: Server): Promise<Client> {
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide);
  const client = new Client({ name: "call-site-test", version: "0.0.0" }, { capabilities: {} });
  await client.connect(clientSide);
  return client;
}

/** The JSON body of a tool result's first text block. */
export function bodyOf(result: any): any {
  return JSON.parse(result.content[0].text);
}

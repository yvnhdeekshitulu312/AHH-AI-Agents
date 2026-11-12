import { patientAssistantAgent } from '../agents/patient-assistant/agent.js';
import { patientHistoryAgent } from '../agents/patient-history/agent.js';
import { isToolName } from '../tools/index.js';
import type { AgentDefinition } from './types.js';

/** Register new agents here. */
const agents: AgentDefinition[] = [patientAssistantAgent, patientHistoryAgent];

function buildRegistry(defs: AgentDefinition[]): ReadonlyMap<string, AgentDefinition> {
  const map = new Map<string, AgentDefinition>();
  for (const def of defs) {
    if (!/^[a-z][a-z0-9-]*$/.test(def.id)) throw new Error(`Invalid agent id "${def.id}"`);
    if (map.has(def.id)) throw new Error(`Duplicate agent id "${def.id}"`);
    const unknown = def.tools.filter((t) => !isToolName(t));
    if (unknown.length) throw new Error(`Agent "${def.id}" references unknown tools: ${unknown.join(', ')}`);
    map.set(def.id, def);
  }
  return map;
}

const registry = buildRegistry(agents);

export function getAgent(id: string): AgentDefinition | undefined {
  return registry.get(id);
}

export function listAgents(): Pick<AgentDefinition, 'id' | 'description'>[] {
  return [...registry.values()].map(({ id, description }) => ({ id, description }));
}

import { City, AdvanceChannel } from '@afro-link/shared';

export interface TranscriptEntry {
  role: 'user' | 'assistant';
  content: string;
  at: string;
}

export const MAX_TRANSCRIPT_ENTRIES = 50;

export interface AgentMemoryState {
  lastLoadId?: string;
  lastShipmentId?: string;
  lastOperatorId?: string;
  lastOrigin?: City;
  lastDestination?: City;
  lastWeightTons?: number;
  lastMoneyEtb?: number;
  lastChannel?: AdvanceChannel;
  transcript?: TranscriptEntry[];
}

export interface AgentMemory {
  get(key: string): Promise<AgentMemoryState | undefined>;
  set(key: string, state: AgentMemoryState): Promise<void>;
}

const MAX_SESSIONS = 1000;

export class InMemoryAgentMemory implements AgentMemory {
  private readonly sessions = new Map<string, AgentMemoryState>();

  async get(key: string): Promise<AgentMemoryState | undefined> {
    return this.sessions.get(key);
  }

  async set(key: string, state: AgentMemoryState): Promise<void> {
    if (this.sessions.size >= MAX_SESSIONS && !this.sessions.has(key)) {
      const oldest = this.sessions.keys().next().value;
      if (oldest !== undefined) this.sessions.delete(oldest);
    }
    this.sessions.set(key, state);
  }
}

import type { Config } from '../config.js';
import { LiveSapGateway } from './live.js';
import { MockSapGateway } from './mock.js';
import type { SapGateway } from './types.js';

export function createSapGateway(cfg: Config): SapGateway {
  return cfg.SAP_MODE === 'live' ? new LiveSapGateway(cfg) : new MockSapGateway();
}
export type { SapGateway } from './types.js';

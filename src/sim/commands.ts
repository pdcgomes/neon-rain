import type { Ipa } from './types.ts';

/**
 * Everything a player can do is expressed as a command. The sim only changes
 * in response to commands, which is what makes networked play possible later.
 */
export type Command =
  | { type: 'move'; agents: number[]; x: number; y: number }
  | { type: 'aim'; agents: number[]; x: number; y: number; firing: boolean }
  | { type: 'secondary'; agents: number[]; x: number; y: number }
  | { type: 'weapon'; agents: number[]; slot: number }
  | { type: 'cycleWeapon'; agents: number[] }
  | { type: 'holster'; agents: number[] }
  | { type: 'team'; agents: number[]; team: number }
  | { type: 'ipa'; agents: number[]; channel: keyof Ipa; value: number }
  | { type: 'overdrive'; agents: number[]; active: boolean };

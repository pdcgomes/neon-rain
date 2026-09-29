/**
 * Balance scenarios: small arenas, each with a brute-force plan and the intended tactical plan.
 * See arena.ts for the map legend. Teams: A = agents 1-2, B = agents 3-4.
 */
import type { Vec2 } from '../../src/sim/types.ts';
import { arena, type Arena } from './arena.ts';
import type { Plan } from './bot.ts';

/** Pass/fail bands for a plan's averages over all seeds. Unset bounds aren't checked. */
export interface Expect {
  minWin?: number;
  maxWin?: number;
  minLost?: number;
  maxLost?: number;
  minDmg?: number;
  maxDmg?: number;
  /** Pass if any one bound holds rather than all of them. */
  any?: boolean;
}

/**
 * An arena drawn in ASCII, or a real mission (`mission`: a converted mission id) with waypoints
 * read off `node scripts/balance.ts --map <id>`. On a real mission, plans can end on the
 * objective ("goal") and a scripted squad (`plan.bot`) finishes whatever is left.
 */
export interface Scenario {
  id: string;
  about: string;
  arena?: Arena;
  mission?: string;
  points?: Record<string, Vec2>;
  plans: Record<string, Plan & { expect?: Expect }>;
}

/** Brute force should cost at least an agent on average, or fail outright half the time. */
export const BRUTE: Expect = { minLost: 1, maxWin: 0.5, any: true };
/** The intended approach should usually win, hurt, and rarely cost an agent. */
export const TACTIC: Expect = { minWin: 0.85, maxLost: 0.6, minDmg: 0.15, maxDmg: 0.6 };

const SPLIT = { A: [0, 1], B: [2, 3] };

/** A mission's own rush and careful squads, to compare a plan against. */
const BASELINES: Scenario['plans'] = {
  rush: { kind: 'brute', about: 'Group mode, best gun out, straight at the objective.', bot: 'rush' },
  careful: { kind: 'tactic', about: 'The generic careful squad, neutral IPA.', bot: 'careful', expect: {} },
};

export const scenarios: Scenario[] = [
  {
    id: 'gridruin',
    mission: 'revolt_24',
    about:
      'Grid Ruin (American Revolt): persuade a man held in a walled courtyard by six rival agents, walk him to a point in the north-west below a row of guard alcoves, and extract by the drop zone. A west road is lined with rival agents; a heavy-weapon compound sits in the south-east.',
    points: {
      D: { x: 237, y: 49 },
      P1: { x: 238, y: 150 },
      P2: { x: 120, y: 162 },
      S1: { x: 96, y: 186 },
      S2: { x: 96, y: 196 },
      N1: { x: 100, y: 110 },
      N1b: { x: 80, y: 78 },
      N1c: { x: 88, y: 70 },
      G1: { x: 38, y: 62 },
      G2: { x: 46, y: 63 },
      H1: { x: 52, y: 56 },
      H2: { x: 70, y: 57 },
      X0: { x: 70, y: 60 },
      X1: { x: 84, y: 58 },
      X2: { x: 110, y: 72 },
      X3: { x: 128, y: 66 },
      X4: { x: 175, y: 66 },
    },
    plans: {
      ...BASELINES,
      lasers: {
        kind: 'tactic',
        about:
          'Holstered down the east side and along the middle; lasers on the courtyard from 30 m, just outside the rivals\' sight; persuade him; up through the open city to the point; out the way the finishing squad chooses.',
        ipa: 'managed',
        teams: SPLIT,
        // The two rivals watching the drop zone, the courtyard's guards, the heavy nest by the point.
        priority: ['p38', 'p39', 'p62', 'p63', 'p64', 'p65', 'p66', 'p18', 'p19', 'p77', 'p16', 'p17', 'p69', 'p78'],
        steps: [
          { moves: [{ team: 'A', to: 'D' }, { team: 'B', to: 'D' }], weapon: 'laser', ipa: 'max', hold: 2, settle: 2 },
          { moves: [{ team: 'A', to: 'P1', quiet: true }, { team: 'B', to: 'P1', quiet: true }] },
          { moves: [{ team: 'A', to: 'P2', quiet: true }, { team: 'B', to: 'P2', quiet: true }] },
          { moves: [{ team: 'A', to: 'S1' }, { team: 'B', to: 'S2' }], weapon: 'laser', ipa: 'max', hold: 6, settle: 4 },
          { moves: [], handOff: true },
          // The police are hostile after the courtyard: clear them bound by bound, bars up.
          { moves: [{ team: 'A', to: 'N1' }, { team: 'B', to: 'N1' }], weapon: 'minigun', ipa: 'max', settle: 4 },
          { moves: [{ team: 'A', to: 'N1b' }, { team: 'B', to: 'N1c' }], weapon: 'minigun', ipa: 'max', settle: 4 },
          // The nest can only be seen from due south, where an officer stands: him first, then rockets into the stack.
          { moves: [{ team: 'A', to: 'G1' }, { team: 'B', to: 'G2' }], weapon: 'laser', ipa: 'max', hold: 8, settle: 4 },
          { moves: [{ team: 'A', to: 'G1' }, { team: 'B', to: 'G2' }], weapon: 'gauss', ipa: 'max', hold: 5 },
          // The two Gauss heavies in the side alcoves survive the rocket: each has its own firing spot.
          { moves: [{ team: 'A', to: 'H1' }, { team: 'B', to: 'H2' }], weapon: 'laser', ipa: 'max', hold: 4, settle: 3 },
          { moves: [{ team: 'A', to: 'goal' }, { team: 'B', to: 'goal' }], weapon: 'minigun', untilObjective: true },
          // Out with the escort: team A clears each bound with lasers from just outside the rivals' sight, B follows.
          { moves: [{ team: 'A', to: 'X1' }, { team: 'B', to: 'X0' }], weapon: 'laser', ipa: 'max', hold: 3, settle: 3 },
          { moves: [{ team: 'A', to: 'X2' }, { team: 'B', to: 'X1' }], weapon: 'laser', ipa: 'max', hold: 3, settle: 3 },
          { moves: [{ team: 'A', to: 'X3' }, { team: 'B', to: 'X2' }], weapon: 'laser', ipa: 'max', hold: 3, settle: 3 },
          { moves: [{ team: 'A', to: 'X4' }, { team: 'B', to: 'X3' }], weapon: 'laser', ipa: 'max', hold: 3, settle: 3 },
        ],
      },
    },
  },
  {
    id: 'alleyway',
    mission: 'synd_13',
    about:
      'The Alleyway: reach a point at the far north end of a 270 m map and come back. 44 guards with Uzis, miniguns and long-range rifles. Three lanes run north: guard houses line the central one, three guards hold the east one, the west one is empty. They meet in an open area (two heavies, two guards) below a pillared column that guards the only passage into the objective room.',
    points: { W1: { x: 26, y: 226 }, W2: { x: 26, y: 108 }, W2b: { x: 30, y: 122 }, W3: { x: 26, y: 64 }, W4: { x: 46, y: 62 }, S2: { x: 36, y: 100 } },
    plans: {
      ...BASELINES,
      westLane: {
        kind: 'tactic',
        about:
          'Holstered up the empty west lane in two teams 14 m apart; snipe the two Gauss guards in the open area with long-range rifles from the lane mouth; clear the west sub-lane, hit the pillared column from the side, then the room; back out the same way.',
        ipa: 'managed',
        loadout: ['longRange', 'uzi', 'minigun', 'persuadertron'],
        teams: SPLIT,
        // The two Gauss guards, and the minigun patrolling the way out.
        priority: ['p50', 'p51', 'p26'],
        steps: [
          { moves: [{ team: 'A', to: 'W1', quiet: true }, { team: 'B', to: 'W1', quiet: true }] },
          { moves: [{ team: 'A', to: 'W2', quiet: true }, { team: 'B', to: 'W2b', quiet: true }] },
          { moves: [{ team: 'A', to: 'W2' }, { team: 'B', to: 'W2b' }], weapon: 'longRange', hold: 6, settle: 4 },
          { moves: [{ team: 'A', to: 'W3' }, { team: 'B', to: 'W2' }], weapon: 'minigun', settle: 4 },
          { moves: [{ team: 'A', to: 'W4' }, { team: 'B', to: 'W3' }], settle: 5 },
          { moves: [{ team: 'A', to: 'W4' }, { team: 'B', to: 'S2' }], weapon: 'longRange', hold: 6, settle: 4 },
          { moves: [{ team: 'A', to: 'goal' }, { team: 'B', to: 'goal' }], weapon: 'minigun', untilObjective: true },
          { moves: [{ team: 'A', to: 'W3' }, { team: 'B', to: 'W3' }] },
          { moves: [{ team: 'A', to: 'W2' }, { team: 'B', to: 'W2b' }] },
          { moves: [{ team: 'A', to: 'W1' }, { team: 'B', to: 'W1' }] },
        ],
      },
    },
  },
  {
    id: 'patrol',
    about: 'Three rivals patrol a street past the alley the squad starts in. A control: even a rush should win this.',
    arena: arena(
      'patrol',
      [
        '########################################',
        '########################################',
        '########################################',
        '#.........1......................2.....#',
        '#.....................r..r..r..........#',
        '#......................................#',
        '#......................................#',
        '#......................................#',
        '##########...###########################',
        '##########...###########################',
        '##########...###########################',
        '##########.4.###########################',
        '##########...###########################',
        '##########.S.###########################',
        '##########...###########################',
        '########################################',
      ],
      (spawns, pts) => {
        for (const s of spawns) s.patrol = [pts['1'], pts['2']];
      },
    ),
    plans: {
      rush: { kind: 'brute', about: 'Charge out and chase them down.', expect: { minWin: 0.8, maxDmg: 0.7 } },
      ambush: {
        kind: 'tactic',
        about: 'Wait just inside the alley and take them as they pass the mouth.',
        steps: [{ moves: [{ team: 'all', to: '4' }], hold: 25, settle: 4 }],
        expect: { minWin: 0.9, maxLost: 0.3, minDmg: 0.05, maxDmg: 0.45 },
      },
    },
  },
  {
    id: 'plaza',
    about: 'Four bodyguards and a Gauss heavy hold an open plaza around a monument. Two ways in: south and east.',
    arena: arena('plaza', [
      '####################################',
      '####################################',
      '####....................############',
      '####....................############',
      '####....................############',
      '####....................############',
      '####.........h..........############',
      '####.......g....g.......############',
      '####........====..................##',
      '####........====........4..2......##',
      '####........====..................##',
      '####.......g....g.......#######...##',
      '####....................#######...##',
      '####....................#######...##',
      '####....................#######...##',
      '####....................#######...##',
      '####....................#######...##',
      '####.........3..........#######...##',
      '############...################...##',
      '############.1.################...##',
      '############...################...##',
      '############...################...##',
      '############...################...##',
      '############...################...##',
      '############...################...##',
      '############......................##',
      '############.S....................##',
      '############......................##',
      '####################################',
    ]),
    plans: {
      rush: { kind: 'brute', about: 'All four up the south alley and across the open plaza.' },
      pincer: {
        kind: 'tactic',
        about: 'A waits holstered in the south alley while B circles to the east entrance; both open up from the edges at once.',
        teams: SPLIT,
        steps: [
          { moves: [{ team: 'A', to: '1', quiet: true }, { team: 'B', to: '2', quiet: true }] },
          { moves: [{ team: 'A', to: '3' }, { team: 'B', to: '4' }], hold: 6 },
        ],
      },
      funnel: {
        kind: 'tactic',
        about: 'Step into the plaza to draw them, then fall back into the alley and hold its mouth.',
        steps: [
          { moves: [{ team: 'all', to: '3' }], hold: 1 },
          { moves: [{ team: 'all', to: '1' }], hold: 6, settle: 4 },
        ],
      },
    },
  },
  {
    id: 'crossfire',
    about: 'Two guard teams cover a junction from either side. Walk into the middle and both open up.',
    arena: arena('crossfire', [
      '############################################',
      '###################.....####################',
      '###################.....####################',
      '###################.....####################',
      '###################.....####################',
      '###################.....####################',
      '###################.....####################',
      '###################.....####################',
      '###################.....####################',
      '###################.....####################',
      '###################.....####################',
      '###################.....####################',
      '#..........................................#',
      '#..............g...........g...............#',
      '#......1.....g.....2.........g.............#',
      '#..............g...........g...............#',
      '#..........................................#',
      '#####...###########.....####################',
      '#####...###########.....####################',
      '#####...###########.....####################',
      '#####...###########.....####################',
      '#####...###########.....####################',
      '#####.3.###########.....####################',
      '#####...###########.....####################',
      '#####...................####################',
      '#####...................####################',
      '#####...................####################',
      '###################..S..####################',
      '###################.....####################',
      '############################################',
    ]),
    plans: {
      rush: { kind: 'brute', about: 'Straight up the street into the junction.' },
      flank: {
        kind: 'tactic',
        about: 'Round the back alley, hit the west team from behind out of the east team\'s sight, then push east.',
        steps: [
          { moves: [{ team: 'all', to: '3', quiet: true }] },
          { moves: [{ team: 'all', to: '1' }], settle: 4 },
          { moves: [{ team: 'all', to: '2' }], hold: 2 },
        ],
      },
    },
  },
  {
    id: 'compound',
    about: 'A walled compound with sandbagged guards covering the front gate and a heavy at the back. There is a gap in the rear wall.',
    arena: arena('compound', [
      '########################################',
      '#......................................#',
      '#.........................2............#',
      '#......................................#',
      '#.......==================..====.......#',
      '#.......=......................=.......#',
      '#.......=...........h.....4....=.......#',
      '#.......=......................=.......#',
      '#.......=......................=.......#',
      '#.......=......................=.......#',
      '#.......=......................=.......#',
      '#.......=..........g.g.........=.......#',
      '#.......=......................=.......#',
      '#.......=......................=.......#',
      '#.......=.......g.......g......=.......#',
      '#.......=.......==....==.......=.......#',
      '#.......=......................=.......#',
      '#.......==========....==========.......#',
      '#......................................#',
      '#..............1...3...............5...#',
      '#......................................#',
      '#......................................#',
      '#......................................#',
      '#......................................#',
      '#......................................#',
      '#......................................#',
      '#...................S..................#',
      '#......................................#',
      '#......................................#',
      '########################################',
    ]),
    plans: {
      rush: { kind: 'brute', about: 'Through the front gate.' },
      breach: {
        kind: 'tactic',
        about: 'A stacks up beside the gate while B sneaks round to the rear gap; A draws the guards to the gate, then B comes in behind them.',
        teams: SPLIT,
        steps: [
          { moves: [{ team: 'A', to: '1', quiet: true }, { team: 'B', to: '5', quiet: true }] },
          { moves: [{ team: 'B', to: '2', quiet: true }] },
          { moves: [{ team: 'A', to: '3' }, { team: 'B', to: '4' }], hold: 3 },
        ],
      },
      lure: {
        kind: 'tactic',
        about: 'Show yourselves at the gate, then fall back beside it and cut the guards down as they come through.',
        steps: [
          { moves: [{ team: 'all', to: '3' }], hold: 1 },
          { moves: [{ team: 'all', to: '1' }], hold: 6, settle: 4 },
        ],
      },
    },
  },
];

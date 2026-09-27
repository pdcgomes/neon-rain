/**
 * Prompt presets for Tripo, mirroring the character designs in src/lab/kits/designs.ts.
 * Keep faction colours and silhouettes in sync with the lab so generated models compare fairly.
 */
export interface Preset {
  kind: 'agent' | 'rival' | 'heavy' | 'guard' | 'voss' | 'police' | 'enforcer' | 'civilian';
  name: string;
  height: number;
  prompt: string;
  /** Lab reference images (captured with window.lab.captureRefs) for image / multiview modes. */
  subject: string;
}

const BASE =
  'full body game character, A-pose, arms slightly away from body, standing straight, facing forward, clean readable silhouette, cyberpunk neon noir, single character, no base, no background';

export const PRESETS: Record<string, Preset> = {
  agent: {
    kind: 'agent',
    name: 'Eurocorp Agent',
    height: 1.84,
    subject: 'agent:0',
    prompt: `${BASE}. Corporate cyborg agent: long black leather trench coat flaring to the knees with a thin glowing cyan hem line, raised collar and lapels, black gloves, heavy boots, slicked-back dark hair, glowing cyan wraparound visor band across the eyes, compact submachine gun held low in the right hand, belt with glowing cyan buckle, thigh holster`,
  },
  rival: {
    kind: 'rival',
    name: 'Rival Agent',
    height: 1.83,
    subject: 'rival:0',
    prompt: `${BASE}. Rival syndicate agent: steel-grey long coat, armoured shoulder pads, glowing red visor band, buzz-cut hair, dark gloves, submachine gun in right hand`,
  },
  heavy: {
    kind: 'heavy',
    name: 'Rival Heavy',
    height: 1.95,
    subject: 'heavy:0',
    prompt: `${BASE}. Bulky armoured heavy soldier: dark gunmetal plate armour, big shoulder pads, full helmet with a glowing red visor slit, oversized gauss cannon with glowing cyan coils held at the hip`,
  },
  police: {
    kind: 'police',
    name: 'Police Officer',
    height: 1.82,
    subject: 'police:0',
    prompt: `${BASE}. Futuristic city police officer: navy blue uniform jacket, peaked cap with a small glowing badge, belt, shoulder-mounted blue light, pistol in right hand`,
  },
  enforcer: {
    kind: 'enforcer',
    name: 'Enforcer',
    height: 1.92,
    subject: 'enforcer:0',
    prompt: `${BASE}. Riot enforcer: heavy dark armour with blue accent lights, full helmet with a glowing blue visor, armoured shoulder pads, carbine rifle`,
  },
  voss: {
    kind: 'voss',
    name: 'Director Hale Voss',
    height: 1.78,
    subject: 'voss:0',
    prompt: `${BASE}. Portly corporate executive: cream white three-piece suit, gold tie and gold accents, slicked grey hair, confident stance`,
  },
  civilian: {
    kind: 'civilian',
    name: 'Courier',
    height: 1.72,
    subject: 'civilian:1',
    prompt: `${BASE}. Street courier civilian: teal hoodie with the hood up and a glowing cyan LED strip across the chest, dark trousers, sneakers`,
  },
};

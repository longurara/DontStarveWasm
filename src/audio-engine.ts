import type { GameSceneSnapshot } from './game-renderer';

interface AudioBankSample {
  index: number;
  name: string;
  sampleRate: number;
  channels: number;
  bitsPerSample: number;
  url: string;
}

interface AudioBankManifest {
  source: string;
  samples: AudioBankSample[];
}

interface ActiveLoop {
  source: AudioBufferSourceNode;
  gain: GainNode;
  url: string;
}

const CHARACTER_BANK_MAP: Record<string, { bank: string; talkPrefix: string; hurtPrefix: string; ghostPrefix: string; deathPrefix: string }> = {
  wilson: { bank: 'wilson', talkPrefix: 'WilsonVoice_generic_', hurtPrefix: 'WilsonVoice_hurt_', ghostPrefix: 'WilsonVoice_ghost_', deathPrefix: 'death_voice_trumpet' },
  willow: { bank: 'willow', talkPrefix: 'WillowVoice_generic_', hurtPrefix: 'WillowVoice_hurt_', ghostPrefix: 'WillowVoice_ghost_', deathPrefix: 'WillowVoice_death_' },
  wolfgang: { bank: 'wolfgang', talkPrefix: 'Wolfgang_generic_', hurtPrefix: 'Wolfgang_hurt_', ghostPrefix: 'WolfgangVoice_ghost_', deathPrefix: 'Wolfgang_death_' },
  wendy: { bank: 'wendy', talkPrefix: 'Wendy_generic_', hurtPrefix: 'Wendy_hurt_', ghostPrefix: 'WendyVoice_ghost_', deathPrefix: 'Wendy_death_' },
  wx78: { bank: 'wx78', talkPrefix: 'Woodrow_generic_', hurtPrefix: 'Woodrow_hurt_', ghostPrefix: 'WX_voice_ghost_', deathPrefix: 'wx78_gestaltposssessed_death_voice' },
  wickerbottom: { bank: 'wickerbottom', talkPrefix: 'Wickerbottom_generic_', hurtPrefix: 'Wickerbottom_hurt_', ghostPrefix: 'WickerbottomVoice_ghost_', deathPrefix: 'Wickerbottom_death_' },
  woodie: { bank: 'woodie', talkPrefix: 'Woodie_generic_', hurtPrefix: 'Woodie_hurt_', ghostPrefix: 'WoodieVoice_ghost_', deathPrefix: 'Woodie_death_' },
  wes: { bank: 'wes', talkPrefix: 'wes_hurt_', hurtPrefix: 'wes_hurt_', ghostPrefix: 'wes_ghost_', deathPrefix: 'wes_death_' },
  waxwell: { bank: 'maxwell_rework', talkPrefix: 'maxwell_', hurtPrefix: 'maxwell_', ghostPrefix: 'maxwell_', deathPrefix: 'maxwell_' },
  wathgrithr: { bank: 'winnie', talkPrefix: 'winnie_generic_', hurtPrefix: 'winnie_hurt_', ghostPrefix: 'winnie_ghost_', deathPrefix: 'winnie_death_' },
  webber: { bank: 'webber', talkPrefix: 'webber_talk_', hurtPrefix: 'webber_hurt_', ghostPrefix: 'webber_ghost_', deathPrefix: 'webber_death_' },
  winona: { bank: 'winona', talkPrefix: 'winona_generic_', hurtPrefix: 'winona_hurt_', ghostPrefix: 'winona_ghost_', deathPrefix: 'winona_death_' },
  warly: { bank: 'wilson', talkPrefix: 'WilsonVoice_generic_', hurtPrefix: 'WilsonVoice_hurt_', ghostPrefix: 'WilsonVoice_ghost_', deathPrefix: 'death_voice_trumpet' },
  wortox: { bank: 'wortox', talkPrefix: 'wortox_talk_', hurtPrefix: 'wortox_hurt_', ghostPrefix: 'wortox_ghost_', deathPrefix: 'wortox_death_' },
  wormwood: { bank: 'wormwood', talkPrefix: 'wormwood_talk_', hurtPrefix: 'wormwood_hurt_', ghostPrefix: 'wormwood_ghost_', deathPrefix: 'wormwood_death_' },
  wurt: { bank: 'wilson', talkPrefix: 'WilsonVoice_generic_', hurtPrefix: 'WilsonVoice_hurt_', ghostPrefix: 'WilsonVoice_ghost_', deathPrefix: 'death_voice_trumpet' },
  walter: { bank: 'wilson', talkPrefix: 'WilsonVoice_generic_', hurtPrefix: 'WilsonVoice_hurt_', ghostPrefix: 'WilsonVoice_ghost_', deathPrefix: 'death_voice_trumpet' },
  wanda: { bank: 'wanda1', talkPrefix: 'wanda_', hurtPrefix: 'wanda_', ghostPrefix: 'wanda_', deathPrefix: 'wanda_' },
};

const CORE_BANKS = [
  'wilson',
  'forest',
  'birds',
  'aqol',
  'yoth_2026',
  'spider',
  'pig',
  'hound',
  'rabbit',
  'ghost',
  'beefalo',
  'frog',
  'bee',
  'music_frontend',
  'DLC_music',
];

export class DstAudioEngine {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private sfxGain: GainNode | null = null;
  private musicGain: GainNode | null = null;
  private ambientGain: GainNode | null = null;
  private muted = false;
  private lastAmbientTick = 0;
  private lastFireTick = 0;
  private currentCharacter = 'wilson';

  private bankCache = new Map<string, AudioBankManifest>();
  private bankPromises = new Map<string, Promise<AudioBankManifest | null>>();
  private bufferCache = new Map<string, AudioBuffer>();
  private bufferPromises = new Map<string, Promise<AudioBuffer | null>>();
  private activeLoops = new Map<string, ActiveLoop>();
  private preloadedCoreBanks = false;

  private ensureContext(): AudioContext | null {
    if (this.muted) return null;
    if (!this.ctx && typeof window !== 'undefined') {
      const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (Ctor) {
        this.ctx = new Ctor();
        this.masterGain = this.ctx.createGain();
        this.masterGain.gain.value = 0.48;
        this.masterGain.connect(this.ctx.destination);

        this.sfxGain = this.ctx.createGain();
        this.sfxGain.gain.value = 0.85;
        this.sfxGain.connect(this.masterGain);

        this.musicGain = this.ctx.createGain();
        this.musicGain.gain.value = 0.35;
        this.musicGain.connect(this.masterGain);

        this.ambientGain = this.ctx.createGain();
        this.ambientGain.gain.value = 0.4;
        this.ambientGain.connect(this.masterGain);
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      void this.ctx.resume().catch(() => {});
    }
    if (!this.preloadedCoreBanks && typeof fetch !== 'undefined') {
      this.preloadedCoreBanks = true;
      for (const bank of CORE_BANKS) {
        void this.loadBank(bank);
      }
    }
    return this.ctx;
  }

  private async loadBank(bankName: string): Promise<AudioBankManifest | null> {
    const cached = this.bankCache.get(bankName);
    if (cached) return cached;
    const inflight = this.bankPromises.get(bankName);
    if (inflight) return inflight;

    const promise = (async () => {
      try {
        const res = await fetch(`/generated/audio/banks/${bankName}.json`);
        if (!res.ok) return null;
        const manifest = (await res.json()) as AudioBankManifest;
        if (manifest && Array.isArray(manifest.samples)) {
          this.bankCache.set(bankName, manifest);
          return manifest;
        }
        return null;
      } catch {
        return null;
      } finally {
        this.bankPromises.delete(bankName);
      }
    })();

    this.bankPromises.set(bankName, promise);
    return promise;
  }

  private async loadSampleBuffer(sampleUrl: string): Promise<AudioBuffer | null> {
    const fullUrl = sampleUrl.startsWith('/') ? sampleUrl : `/generated/${sampleUrl}`;
    const cached = this.bufferCache.get(fullUrl);
    if (cached) return cached;
    const inflight = this.bufferPromises.get(fullUrl);
    if (inflight) return inflight;

    const ctx = this.ensureContext();
    if (!ctx) return null;

    const promise = (async () => {
      try {
        const res = await fetch(fullUrl);
        if (!res.ok) return null;
        const arrayBuf = await res.arrayBuffer();
        const audioBuf = await ctx.decodeAudioData(arrayBuf);
        this.bufferCache.set(fullUrl, audioBuf);
        return audioBuf;
      } catch {
        return null;
      } finally {
        this.bufferPromises.delete(fullUrl);
      }
    })();

    this.bufferPromises.set(fullUrl, promise);
    return promise;
  }

  private async playBankSample(
    bankName: string,
    samplePrefixOrExact: string,
    volume = 1.0,
    options?: { loopName?: string; loop?: boolean; bus?: 'sfx' | 'music' | 'ambient'; playbackRate?: number },
  ) {
    if (this.muted) return;
    const ctx = this.ensureContext();
    if (!ctx || !this.masterGain) return;

    const manifest = await this.loadBank(bankName);
    if (!manifest || !manifest.samples.length) return;

    const needle = samplePrefixOrExact.toLowerCase();
    let matches = manifest.samples.filter(s => s.name.toLowerCase() === needle);
    if (matches.length === 0) {
      matches = manifest.samples.filter(s => s.name.toLowerCase().startsWith(needle));
    }
    if (matches.length === 0) {
      matches = manifest.samples.filter(s => s.name.toLowerCase().includes(needle));
    }
    if (matches.length === 0) return;

    const chosen = matches[Math.floor(Math.random() * matches.length)];
    const buf = await this.loadSampleBuffer(chosen.url);
    if (!buf || this.muted || !this.ctx) return;

    if (options?.loopName) {
      const existing = this.activeLoops.get(options.loopName);
      if (existing && existing.url === chosen.url) {
        existing.gain.gain.setTargetAtTime(Math.max(0.02, Math.min(1.0, volume)), this.ctx.currentTime, 0.05);
        return;
      }
      this.killSound(options.loopName);
    }

    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.loop = Boolean(options?.loop);
    if (options?.playbackRate) {
      src.playbackRate.value = options.playbackRate;
    }

    const gain = this.ctx.createGain();
    gain.gain.value = Math.max(0.02, Math.min(1.0, volume));

    const targetBus =
      options?.bus === 'music'
        ? this.musicGain
        : options?.bus === 'ambient'
          ? this.ambientGain
          : this.sfxGain;
    src.connect(gain);
    gain.connect(targetBus ?? this.masterGain);
    src.start(0);

    if (options?.loopName) {
      const loopKey = options.loopName;
      this.activeLoops.set(loopKey, { source: src, gain, url: chosen.url });
      src.onended = () => {
        const cur = this.activeLoops.get(loopKey);
        if (cur?.source === src) {
          this.activeLoops.delete(loopKey);
        }
      };
    }
  }

  setMuted(muted: boolean) {
    this.muted = muted;
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setValueAtTime(muted ? 0 : 0.48, this.ctx.currentTime);
    }
    if (muted) {
      this.killAllSounds();
    }
  }

  isMuted(): boolean {
    return this.muted;
  }

  unlock() {
    this.ensureContext();
  }

  killSound(name: string) {
    const active = this.activeLoops.get(name);
    if (active) {
      try {
        active.source.stop();
        active.source.disconnect();
        active.gain.disconnect();
      } catch {
        // Ignore already-stopped source
      }
      this.activeLoops.delete(name);
    }
  }

  killAllSounds() {
    for (const key of Array.from(this.activeLoops.keys())) {
      this.killSound(key);
    }
  }

  setVolume(name: string, volume: number) {
    const active = this.activeLoops.get(name);
    if (active && this.ctx) {
      active.gain.gain.setTargetAtTime(Math.max(0, Math.min(1.0, volume)), this.ctx.currentTime, 0.04);
    }
  }

  playHudClick() {
    void this.playBankSample('wilson', 'talkPopUp', 0.55);
  }

  playMusic(mode: 'fe' | 'work_spring' | 'work_summer' | 'fight' | 'stop') {
    if (mode === 'stop') {
      this.killSound('BGM');
      return;
    }
    if (mode === 'fe') {
      void this.playBankSample('music_frontend', 'DST_Theme_Loop', 0.45, { loopName: 'BGM', loop: true, bus: 'music' });
    } else if (mode === 'work_spring') {
      void this.playBankSample('DLC_music', 'DS_Spring_Working_120bpm', 0.4, { loopName: 'BGM', loop: true, bus: 'music' });
    } else if (mode === 'work_summer') {
      void this.playBankSample('DLC_music', 'DS_Summer_Working', 0.4, { loopName: 'BGM', loop: true, bus: 'music' });
    } else if (mode === 'fight') {
      void this.playBankSample('DLC_music', 'DS_Spring_Fight_140bpm', 0.48, { loopName: 'BGM', loop: true, bus: 'music' });
    }
  }

  playEvents(events: Array<{ path: string; name?: string; volume?: number; action?: string }>, character?: string) {
    if (this.muted || !Array.isArray(events)) return;
    if (character) {
      this.currentCharacter = character.toLowerCase();
    }
    for (const ev of events.slice(0, 8)) {
      if (ev?.action === 'kill' && ev.name) {
        this.killSound(ev.name);
        continue;
      }
      if (ev?.action === 'killall') {
        this.killAllSounds();
        continue;
      }
      if (ev?.path) {
        this.playEvent(ev.path, ev.volume ?? 0.9, ev.name);
      }
    }
  }

  updateAmbient(phase: string) {
    if (this.muted) return;
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const now = ctx.currentTime;
    if (now - this.lastAmbientTick >= 5.5) {
      this.lastAmbientTick = now;
      if (phase === 'day') {
        const prefixes = ['Birdchirp_robin_', 'Birdchirp_junco_', 'Crow_chirp_'];
        const pick = prefixes[Math.floor(Math.random() * prefixes.length)];
        void this.playBankSample('birds', pick, 0.35, { bus: 'ambient' });
      } else if (phase === 'dusk') {
        void this.playBankSample('birds', 'Crow_chirp_', 0.28, { bus: 'ambient' });
      }
    }
  }

  private resolveFmodEventToBankSample(event: string): { bank: string; sample: string; loop?: boolean; bus?: 'sfx' | 'music' | 'ambient' } {
    const ev = event.toLowerCase();
    const charMeta = CHARACTER_BANK_MAP[this.currentCharacter] ?? CHARACTER_BANK_MAP.wilson;

    // Music events
    if (ev.includes('music_fe') || ev.includes('frontend')) {
      return { bank: 'music_frontend', sample: 'DST_Theme_Loop', loop: true, bus: 'music' };
    }
    if (ev.includes('music_epicfight') || ev.includes('music_danger')) {
      return { bank: 'DLC_music', sample: 'DS_Spring_Fight_140bpm', loop: true, bus: 'music' };
    }
    if (ev.includes('music_work') || ev.includes('music/')) {
      return { bank: 'DLC_music', sample: 'DS_Spring_Working_120bpm', loop: true, bus: 'music' };
    }

    // Character voices (talk, hurt, death, ghost, yawn)
    if (ev.includes('talk_lp') || ev.includes('/talk') || ev.includes('pose')) {
      return { bank: charMeta.bank, sample: charMeta.talkPrefix };
    }
    if (ev.includes('ghost_lp') || ev.includes('ghost')) {
      return { bank: charMeta.bank, sample: charMeta.ghostPrefix };
    }
    if (ev.includes('death_voice') || ev.includes('death_body')) {
      return { bank: charMeta.bank, sample: charMeta.deathPrefix };
    }
    if (ev.includes('yawn')) {
      return { bank: 'wilson', sample: 'wilson_yawn' };
    }
    if (ev.includes('hurt')) {
      if (ev.includes('spider')) return { bank: 'spider', sample: 'Spider_scream_' };
      if (ev.includes('pig')) return { bank: 'pig', sample: 'pig_grunts_' };
      if (ev.includes('hound')) return { bank: 'hound', sample: 'Hound_hurt_' };
      return { bank: charMeta.bank, sample: charMeta.hurtPrefix };
    }

    // Creature sounds
    if (ev.includes('spider')) {
      if (ev.includes('attack') || ev.includes('bite')) return { bank: 'spider', sample: 'Spider_attack_' };
      if (ev.includes('die') || ev.includes('death')) return { bank: 'spider', sample: 'Spider_death_' };
      if (ev.includes('sleep')) return { bank: 'spider', sample: 'Spider_sleeping_' };
      if (ev.includes('walk') || ev.includes('step')) return { bank: 'spider', sample: 'Spider_step_' };
      return { bank: 'spider', sample: 'Spider_scream_' };
    }
    if (ev.includes('pig')) {
      if (ev.includes('oink') || ev.includes('grunt')) return { bank: 'pig', sample: 'Pig_oink_' };
      if (ev.includes('death') || ev.includes('die')) return { bank: 'pig', sample: 'Pig_death_' };
      if (ev.includes('attack')) return { bank: 'pig', sample: 'werepig_attack_' };
      return { bank: 'pig', sample: 'pig_grunts_' };
    }
    if (ev.includes('hound')) {
      if (ev.includes('bark')) return { bank: 'hound', sample: 'Hound_bark_' };
      if (ev.includes('attack') || ev.includes('bite')) return { bank: 'hound', sample: 'Hound_attack_' };
      if (ev.includes('death') || ev.includes('die')) return { bank: 'hound', sample: 'Hound_death_' };
      return { bank: 'hound', sample: 'Hound_growl_' };
    }
    if (ev.includes('rabbit') || ev.includes('bunny')) {
      if (ev.includes('hop')) return { bank: 'rabbit', sample: 'bunnyHop_grass_' };
      return { bank: 'rabbit', sample: 'rabbit_scream_short_' };
    }
    if (ev.includes('bird') || ev.includes('crow') || ev.includes('robin')) {
      if (ev.includes('takeoff') || ev.includes('fly')) return { bank: 'birds', sample: 'bird_takeoff' };
      return { bank: 'birds', sample: 'Birdchirp_robin_' };
    }
    if (ev.includes('beefalo')) {
      return { bank: 'beefalo', sample: 'Beefalo_' };
    }
    if (ev.includes('frog')) {
      return { bank: 'frog', sample: 'Frog_' };
    }
    if (ev.includes('bee')) {
      return { bank: 'bee', sample: 'bee_' };
    }

    // World & Wilson interaction sounds
    if (ev.includes('treefall') || ev.includes('tree_fall')) {
      return { bank: 'forest', sample: 'tree_fall_1' };
    }
    if (ev.includes('treecrumble') || ev.includes('tree_crumble')) {
      return { bank: 'forest', sample: 'Tree_crumble' };
    }
    if (ev.includes('chop') || ev.includes('use_axe') || ev.includes('wood')) {
      return { bank: 'wilson', sample: 'gather_wood_' };
    }
    if (ev.includes('rock_break') || ev.includes('stone_break') || ev.includes('destroy_stone')) {
      return { bank: 'wilson', sample: 'Stone_break' };
    }
    if (ev.includes('mine') || ev.includes('use_pick') || ev.includes('rock') || ev.includes('ice')) {
      return { bank: 'wilson', sample: 'pickaxe_hitrock_v2' };
    }
    if (ev.includes('dig') || ev.includes('shovel')) {
      return { bank: 'wilson', sample: 'Dig_' };
    }
    if (ev.includes('berry') || ev.includes('berries')) {
      return { bank: 'wilson', sample: 'Harvest_berries_' };
    }
    if (ev.includes('stick') || ev.includes('twig') || ev.includes('sapling')) {
      return { bank: 'wilson', sample: 'Harvest_Sticks_' };
    }
    if (ev.includes('reed') || ev.includes('grass')) {
      return { bank: 'wilson', sample: 'gather_reeds_' };
    }
    if (ev.includes('plant_tree') || ev.includes('pinecone')) {
      return { bank: 'wilson', sample: 'Plant_tree' };
    }
    if (ev.includes('plant')) {
      return { bank: 'wilson', sample: 'Harvest_Plant' };
    }
    if (ev.includes('collect') || ev.includes('pickup') || ev.includes('item_osh')) {
      return { bank: 'wilson', sample: 'Pickup_item' };
    }
    if (ev.includes('backpack_close')) {
      return { bank: 'wilson', sample: 'Backpack_close' };
    }
    if (ev.includes('backpack_open') || ev.includes('backpack')) {
      return { bank: 'wilson', sample: 'Backpack_open' };
    }
    if (ev.includes('chest_close') || ev.includes('close')) {
      return { bank: 'wilson', sample: 'Chest_close' };
    }
    if (ev.includes('chest_open') || ev.includes('open') || ev.includes('chest')) {
      return { bank: 'wilson', sample: 'Chest_open' };
    }
    if (ev.includes('cook') || ev.includes('sizzle')) {
      return { bank: 'wilson', sample: 'Cook_sizzle' };
    }
    if (ev.includes('soup') || ev.includes('crockpot')) {
      return { bank: 'wilson', sample: 'make_soup' };
    }
    if (ev.includes('eat') || ev.includes('bite')) {
      return { bank: 'wilson', sample: 'eat_' };
    }
    if (ev.includes('hungry')) {
      return { bank: 'wilson', sample: 'Hungry_' };
    }
    if (ev.includes('torch')) {
      return { bank: 'wilson', sample: 'Torch_swing_' };
    }
    if (ev.includes('lantern_on')) {
      return { bank: 'wilson', sample: 'lantern_on' };
    }
    if (ev.includes('lantern_off')) {
      return { bank: 'wilson', sample: 'lantern_off' };
    }
    if (ev.includes('tool_break') || ev.includes('break')) {
      return { bank: 'wilson', sample: 'Tool_Break' };
    }
    if (ev.includes('armour') || ev.includes('armor')) {
      return { bank: 'wilson', sample: 'armour_break' };
    }
    if (ev.includes('attack') || ev.includes('whoosh') || ev.includes('hit')) {
      return { bank: 'wilson', sample: 'MakeWhoosh1_' };
    }
    if (ev.includes('craft') || ev.includes('build') || ev.includes('recipe') || ev.includes('research')) {
      return { bank: 'wilson', sample: 'equip_goldItem' };
    }
    if (ev.includes('campfire') || ev.includes('firepit') || ev.includes('fire')) {
      return { bank: 'yoth_2026', sample: 'campfire_layer2_LP', bus: 'ambient' };
    }
    if (ev.includes('footstep') || ev.includes('step')) {
      return { bank: 'aqol', sample: 'Footstep_Sand_' };
    }

    // Default HUD / interaction sound from Klei's wilson bank
    return { bank: 'wilson', sample: 'talkPopUp' };
  }

  playEvent(event: string, volume = 1.0, loopName?: string) {
    if (this.muted) return;
    const resolved = this.resolveFmodEventToBankSample(event);
    void this.playBankSample(resolved.bank, resolved.sample, volume, {
      loopName,
      loop: resolved.loop,
      bus: resolved.bus ?? 'sfx',
    });
  }

  syncScene(scene: GameSceneSnapshot) {
    if (this.muted) return;
    if (scene.player?.prefab) {
      this.currentCharacter = scene.player.prefab.toLowerCase();
    }
    if (Array.isArray(scene.soundEvents)) {
      this.playEvents(scene.soundEvents, scene.player.prefab);
    }
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;

    // Authentic campfire loop / crackle from yoth_2026.fsb when near campfire or firepit
    if (scene.tick - this.lastFireTick >= 45) {
      const hasFire = scene.entities?.some(
        e => (e.prefab === 'campfire' || e.prefab === 'firepit') && Math.hypot(e.x - scene.player.x, e.z - scene.player.z) < 12,
      );
      if (hasFire) {
        this.lastFireTick = scene.tick;
        void this.playBankSample('yoth_2026', 'campfire_layer2_LP', 0.25, { bus: 'ambient' });
      }
    }
    this.updateAmbient(scene.clock.phase);
  }
}

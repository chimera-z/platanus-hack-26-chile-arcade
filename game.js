(() => {
  "use strict";

  const CABINET_KEYS = {
    P1_U: ['w'],
    P1_D: ['s'],
    P1_L: ['a'],
    P1_R: ['d'],
    P1_1: ['u', '1', 'e'],
    P1_2: ['i'],
    P1_3: ['o'],
    P1_4: ['j'],
    P1_5: ['k'],
    P1_6: ['l'],
    P2_U: ['ArrowUp'],
    P2_D: ['ArrowDown'],
    P2_L: ['ArrowLeft'],
    P2_R: ['ArrowRight'],
    P2_1: ['r', 'ShiftRight'],
    P2_2: ['t'],
    P2_3: ['y'],
    P2_4: ['f'],
    P2_5: ['g'],
    P2_6: ['h'],
    START1: ['Enter'],
    START2: ['2'],
  };

  const RULES = {
    width: 800, height: 600, hz: 120, puckSubsteps: 2,
    left: 52, right: 748, ceiling: 224, floor: 500, mouthTop: 306, mouthBottom: 418, goalDepth: 24,
    spawnX: [240, 560],
    fighterWidth: 30, fighterHeight: 52, groundSpeed: 280, airSpeed: 245,
    groundRamp: 0.05, groundStop: 0.045, groundTurn: 0.038, airAcceleration: 4000, airBrake: 3500,
    riseGravity: 1650, fallGravity: 2200, jumpSpeed: 770, jumpBuffer: 0.1,
    reach: 42, strikeHeight: 30, strikeOffset: 19, strikeMove: 0.7,
    windup: 0.075, active: 0.083, recovery: 0.225, strikeBuffer: 0.12,
    recoil: 0.15, stun: 0.65, protection: 0.4, pipDecay: 5, shove: 220, shoveBrake: 1200,
    puckRadius: 11, serveSpeed: 320, serveAngle: -17, shotSpeed: 520, maxPuckSpeed: 560,
    groundShot: -16, airShot: 25, minHorizontal: 0.20, minVertical: 0.16,
    open: 6, goalsToWin: 3, regulation: 90, overtime: 15,
    opening: 2, faceoff: 1, goalCue: 0.8, readyTimeout: 15, resultLock: 1, resultTimeout: 15,
    resume: 1, stuckTime: 1.5, stuckSpan: 16, repair: 0.75
  };
  const FEEL = {
    hitFlash: 0.085, trail: 0.24, shutter: 0.12, maxFlashes: 12,
    impactMs: 170, goalMs: 540, shakeMs: 110, hitShake: 2, goalShake: 4
  };
  const STEP = 1 / RULES.hz;
  const STEP_MS = 1000 * STEP;
  const TICK_CAP = 12;
  const HALF_BODY = RULES.fighterWidth / 2;
  const RADIUS = RULES.puckRadius;
  const CENTER_X = (RULES.left + RULES.right) / 2;
  const CENTER_Y = (RULES.ceiling + RULES.floor) / 2;
  const GOAL_Y = (RULES.mouthTop + RULES.mouthBottom) / 2;
  const HIT_START = ticks(RULES.windup);
  const HIT_END = HIT_START + ticks(RULES.active);
  const SWING_END = HIT_END + ticks(RULES.recovery);
  const TEAM = [0x56dfff, 0xff9658];
  const INK = 0x101725;
  const WHITE = 0xf7faff;
  const GOLD = 0xffe26a;
  const EPSILON = 1e-7;
  const PLAYER_INPUT = [
    { left: 'P1_L', right: 'P1_R', jump: 'P1_U', strike: 'P1_1', start: 'START1' },
    { left: 'P2_L', right: 'P2_R', jump: 'P2_U', strike: 'P2_1', start: 'START2' }
  ];
  const KEYBOARD_START = ['2', 'Enter'];
  const KEYBOARD_CONTROLS = [
    { move: 'A / D', jump: 'W', strike: 'E' },
    { move: '← / →', jump: '↑', strike: 'Shift derecho' }
  ];
  const ARCADE_CONTROLS = { move: '← / →', jump: '↑', strike: '1 de tu lado' };

  /** @param {number} side @param {boolean} useArcadeLabels */
  function startLabel(side, useArcadeLabels) {
    return 'START J' + (side + 1) + (useArcadeLabels ? '' : ' (' + KEYBOARD_START[side] + ')');
  }

  /** @typedef {'title' | 'faceoff' | 'live' | 'goal' | 'repair' | 'result'} Phase */
  /** @typedef {{minX: number, maxX: number, minY: number, maxY: number}} Box */
  /** @typedef {{x: number, y: number, depth: number}} Contact */
  /** @typedef {{start: boolean, move: number, jump: boolean, strike: boolean}} PlayerInput */
  /** @typedef {{at: number, fighter: boolean, puck: boolean}} Swing */
  /** @typedef {{side: number, x: number, y: number, oldX: number, oldY: number,
    vx: number, vy: number, face: number, grounded: boolean, swing: Swing | null, jumpUntil: number, strikeUntil: number,
    pips: number, decayAt: number, blockedUntil: number, protectedUntil: number, stunned: boolean, shove: number}} Fighter */
  /** @typedef {{x: number, y: number, oldX: number, oldY: number, vx: number, vy: number,
    shooter: number, powerUntil: number, watched: Box, stillSince: number}} Puck */
  /** @typedef {{owner: number, until: number}} Gate */
  /** @typedef {'hit' | 'unlock' | 'shot' | 'clang' | 'serve' | 'goal' | 'clash' | 'warning' | 'rail' | 'ready' | 'count' | 'result' | 'swing'} Cue */
  /** @typedef {{cue: Cue, x: number, y: number, side: number}} MatchEvent */

  /** @param {number} seconds */
  function ticks(seconds) { return Math.round(seconds * RULES.hz); }
  /** @param {number} value @param {number} min @param {number} max */
  function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
  /** @param {number} value @param {number} target @param {number} step */
  function approach(value, target, step) {
    return value + clamp(target - value, -step, step);
  }
  /** @param {number} degrees */
  function radians(degrees) { return degrees * Math.PI / 180; }
  /** @param {string} key */
  function normalizeIncomingKey(key) { return key.length === 1 ? key.toLowerCase() : key; }

  /** @param {KeyboardEvent} event */
  function cabinetKey(event) {
    if (event.code === 'ShiftRight') return event.code;
    if (event.code === 'Digit1' || event.code === 'Digit2') return event.code.slice(-1);
    return normalizeIncomingKey(event.key);
  }

  /** @param {KeyboardEvent} event @param {string} key */
  function inputId(event, key) {
    return (event.isTrusted === false ? 'virtual:' : 'physical:') + (event.code || key);
  }

  class CabinetInput {
    constructor() {
      this.lookup = new Map();
      for (const [code, keys] of Object.entries(CABINET_KEYS)) {
        for (const key of keys) this.lookup.set(normalizeIncomingKey(key), code);
      }
      /** @type {Map<string, Set<string>>} */
      this.held = new Map();
      /** @type {Map<string, string>} */
      this.pressedKeys = new Map();
      /** @type {Set<string>} */
      this.edges = new Set();
      /** @param {KeyboardEvent} event */
      this.keydown = (event) => {
        const key = cabinetKey(event);
        // The host sends canonical cabinet keys. Native desktop keys follow seat position.
        const startSide = event.isTrusted ? KEYBOARD_START.indexOf(key) : -1;
        const code = startSide >= 0 ? PLAYER_INPUT[startSide].start : this.lookup.get(key);
        if (!code) return;
        event.preventDefault();
        const id = inputId(event, key);
        if (event.repeat || this.pressedKeys.has(id)) return;
        this.pressedKeys.set(id, code);
        let aliases = this.held.get(code);
        if (!aliases) {
          aliases = new Set();
          this.held.set(code, aliases);
        }
        if (!aliases.size) this.edges.add(code);
        aliases.add(id);
      };
      /** @param {KeyboardEvent} event */
      this.keyup = (event) => {
        if (event.isTrusted && event.defaultPrevented) return;
        const key = cabinetKey(event);
        const id = inputId(event, key);
        const code = this.pressedKeys.get(id);
        if (code || this.lookup.has(key)) event.preventDefault();
        if (code) this.release(id, code);
      };
    }

    /** @param {string} id @param {string} code */
    release(id, code) {
      this.pressedKeys.delete(id);
      const aliases = this.held.get(code);
      aliases?.delete(id);
      if (!aliases?.size) this.held.delete(code);
    }

    clearPhysical() {
      for (const [id, code] of this.pressedKeys) {
        if (!id.startsWith('physical:')) continue;
        this.release(id, code);
        if (!this.held.has(code)) this.edges.delete(code);
      }
    }

    clear() {
      this.held.clear();
      this.pressedKeys.clear();
      this.edges.clear();
    }

    /** @returns {PlayerInput[]} */
    take() {
      const frame = PLAYER_INPUT.map(({ left, right, jump, strike, start }) => {
        const leftHeld = Boolean(this.held.get(left)?.size);
        const rightHeld = Boolean(this.held.get(right)?.size);
        // A direction pressed and released between ticks still gets one tick.
        const move = leftHeld || rightHeld
          ? Number(rightHeld) - Number(leftHeld)
          : Number(this.edges.has(right)) - Number(this.edges.has(left));
        return { move, jump: this.edges.has(jump), strike: this.edges.has(strike), start: this.edges.has(start) };
      });
      this.edges.clear();
      return frame;
    }
  }

  /** @param {number} side @returns {Fighter} */
  function spawnFighter(side) {
    const x = RULES.spawnX[side];
    const y = RULES.floor;
    return {
      side, x, y, oldX: x, oldY: y, vx: 0, vy: 0, face: side === 0 ? 1 : -1,
      grounded: true, swing: null, jumpUntil: -1, strikeUntil: -1, pips: 0, decayAt: 0, blockedUntil: 0,
      protectedUntil: 0, stunned: false, shove: 0
    };
  }

  /** @param {number} now @returns {Puck} */
  function spawnPuck(now) {
    const x = CENTER_X;
    const y = CENTER_Y;
    return {
      x, y, oldX: x, oldY: y, vx: 0, vy: 0, shooter: -1, powerUntil: 0,
      watched: { minX: x, maxX: x, minY: y, maxY: y }, stillSince: now
    };
  }

  /** @param {Fighter} fighter @returns {Box} */
  function bodyBox(fighter) {
    return {
      minX: fighter.x - HALF_BODY, maxX: fighter.x + HALF_BODY,
      minY: fighter.y - RULES.fighterHeight, maxY: fighter.y
    };
  }

  /** @param {Fighter} fighter @returns {Box} */
  function strikeBox(fighter) {
    const edge = fighter.x + fighter.face * HALF_BODY;
    const tip = edge + fighter.face * RULES.reach;
    const centerY = fighter.y - RULES.fighterHeight + RULES.strikeOffset;
    return {
      minX: Math.min(edge, tip), maxX: Math.max(edge, tip),
      minY: centerY - RULES.strikeHeight / 2, maxY: centerY + RULES.strikeHeight / 2
    };
  }

  /** @param {Box} a @param {Box} b */
  function overlaps(a, b) {
    return a.minX < b.maxX && a.maxX > b.minX && a.minY < b.maxY && a.maxY > b.minY;
  }

  /** @param {Pick<Puck, 'x' | 'y' | 'vx' | 'vy'>} puck @param {Box} box @returns {Contact | null} */
  function circleContact(puck, box) {
    const dx = puck.x - clamp(puck.x, box.minX, box.maxX);
    const dy = puck.y - clamp(puck.y, box.minY, box.maxY);
    const distanceSquared = dx * dx + dy * dy;
    if (distanceSquared >= RADIUS * RADIUS) return null;
    if (distanceSquared > EPSILON) {
      const distance = Math.sqrt(distanceSquared);
      return { x: dx / distance, y: dy / distance, depth: RADIUS - distance };
    }

    const faces = [
      { x: 0, y: -1, depth: puck.y - box.minY + RADIUS },
      { x: 0, y: 1, depth: box.maxY - puck.y + RADIUS },
      { x: -1, y: 0, depth: puck.x - box.minX + RADIUS },
      { x: 1, y: 0, depth: box.maxX - puck.x + RADIUS }
    ];
    const nearest = faces.reduce((nearest, face) => {
      if (Math.abs(face.depth - nearest.depth) > EPSILON) {
        return face.depth < nearest.depth ? face : nearest;
      }
      const along = face.x * puck.vx + face.y * puck.vy;
      const nearestAlong = nearest.x * puck.vx + nearest.y * puck.vy;
      return along < nearestAlong ? face : nearest;
    });
    // A centered vertical contact has no basis for choosing left over right.
    if (nearest.x && Math.abs(puck.x - (box.minX + box.maxX) / 2) < EPSILON && Math.abs(puck.vx) < EPSILON) {
      return faces[0].depth <= faces[1].depth ? faces[0] : faces[1];
    }
    return nearest;
  }

  /** @param {Puck} puck @param {Contact} contact */
  function separate(puck, contact) {
    puck.x += contact.x * (contact.depth + EPSILON);
    puck.y += contact.y * (contact.depth + EPSILON);
  }

  /** @param {Puck} puck @param {number} nx @param {number} ny */
  function reflect(puck, nx, ny) {
    const into = puck.vx * nx + puck.vy * ny;
    if (into >= -EPSILON) return false;
    puck.vx -= 2 * into * nx;
    puck.vy -= 2 * into * ny;
    return true;
  }

  /** @param {Puck} puck */
  function capPuckSpeed(puck) {
    const speed = Math.hypot(puck.vx, puck.vy);
    if (speed <= RULES.maxPuckSpeed) return speed;
    puck.vx *= RULES.maxPuckSpeed / speed;
    puck.vy *= RULES.maxPuckSpeed / speed;
    return RULES.maxPuckSpeed;
  }

  /** @param {Puck} puck */
  function puckOutside(puck) {
    return ![puck.x, puck.y, puck.vx, puck.vy].every(Number.isFinite)
      || puck.x < RULES.left - RADIUS || puck.x > RULES.right + RADIUS
      || puck.y < RULES.ceiling - RADIUS || puck.y > RULES.floor + RADIUS;
  }

  /** @param {Puck} puck */
  function steadyPuck(puck) {
    const speed = capPuckSpeed(puck);
    const sx = Math.sign(puck.vx) || Math.sign(CENTER_X - puck.x);
    const sy = Math.sign(puck.vy) || (puck.y >= (RULES.ceiling + RULES.floor) / 2 ? -1 : 1);
    if (sx && Math.abs(puck.vx) < speed * RULES.minHorizontal) {
      puck.vx = sx * speed * RULES.minHorizontal;
      puck.vy = sy * Math.sqrt(speed * speed - puck.vx * puck.vx);
    } else if (Math.abs(puck.vy) < speed * RULES.minVertical) {
      puck.vy = sy * speed * RULES.minVertical;
      puck.vx = sx * Math.sqrt(speed * speed - puck.vy * puck.vy);
    }
  }

  /** @param {Fighter} fighter @param {PlayerInput} input @param {number} now */
  function moveFighter(fighter, input, now) {
    fighter.oldX = fighter.x;
    fighter.oldY = fighter.y;
    if (fighter.pips && now >= fighter.decayAt) fighter.pips = 0;
    if (fighter.swing && now - fighter.swing.at >= SWING_END) fighter.swing = null;
    const blocked = now < fighter.blockedUntil;
    if (blocked) {
      fighter.vx = fighter.shove;
      fighter.shove = approach(fighter.shove, 0, RULES.shoveBrake * STEP);
    } else {
      fighter.stunned = false;
      fighter.shove = 0;
      if (input.strike) fighter.strikeUntil = now + ticks(RULES.strikeBuffer) - 1;
      if (input.move && (!fighter.swing || now - fighter.swing.at >= HIT_END)) fighter.face = input.move;
      if (!fighter.swing) {
        if (now <= fighter.strikeUntil) {
          fighter.swing = { at: now, fighter: false, puck: false };
          fighter.strikeUntil = -1;
        }
      }
      if (input.jump) fighter.jumpUntil = now + ticks(RULES.jumpBuffer) - 1;
      if (fighter.grounded && now <= fighter.jumpUntil) {
        fighter.vy = -RULES.jumpSpeed;
        fighter.grounded = false;
        fighter.jumpUntil = -1;
      }
      const speed = fighter.grounded ? RULES.groundSpeed : RULES.airSpeed;
      const reversing = input.move * fighter.vx < 0;
      const ramp = reversing ? RULES.groundTurn : input.move ? RULES.groundRamp : RULES.groundStop;
      const acceleration = fighter.grounded ? speed / ramp : input.move ? RULES.airAcceleration : RULES.airBrake;
      const target = input.move * speed * (fighter.swing ? RULES.strikeMove : 1);
      fighter.vx = clamp(approach(fighter.vx, reversing ? 0 : target, acceleration * STEP), -speed, speed);
    }
    const nextX = fighter.x + fighter.vx * STEP;
    fighter.x = clamp(nextX, RULES.left + HALF_BODY, RULES.right - HALF_BODY);
    if (fighter.x !== nextX) fighter.vx = 0;
    const gravity = fighter.vy < 0 ? RULES.riseGravity : RULES.fallGravity;
    fighter.y += fighter.vy * STEP + gravity * STEP * STEP / 2;
    fighter.vy += gravity * STEP;
    if (fighter.y >= RULES.floor) {
      fighter.y = RULES.floor;
      fighter.vy = 0;
      fighter.grounded = true;
    } else {
      fighter.grounded = false;
      if (fighter.y < RULES.ceiling + RULES.fighterHeight) {
        fighter.y = RULES.ceiling + RULES.fighterHeight;
        fighter.vy = Math.max(0, fighter.vy);
      }
    }
  }

  /** @param {Fighter[]} fighters */
  function resolveFighters([a, b]) {
    const width = RULES.fighterWidth;
    const height = RULES.fighterHeight;
    const overlapX = width - Math.abs(a.x - b.x);
    const overlapY = height - Math.abs(a.y - b.y);
    if (overlapX <= EPSILON || overlapY <= EPSILON) return;

    const separatedX = Math.abs(a.oldX - b.oldX) >= width - EPSILON;
    const separatedY = Math.abs(a.oldY - b.oldY) >= height - EPSILON;
    if (separatedX === separatedY ? overlapY < overlapX : separatedY) {
      const [upper, lower] = a.y < b.y ? [a, b] : [b, a];
      const lift = Math.min(overlapY, Math.max(0, upper.y - RULES.ceiling - height));
      upper.y -= lift;
      lower.y += overlapY - lift;
      if (lift < overlapY && lower.vy < 0) lower.vy = 0;
      if (upper.vy >= lower.vy) upper.vy = lower.vy;
      upper.grounded = lower.grounded && upper.vy >= 0;
      return;
    }

    const [left, right] = a.oldX < b.oldX || (a.oldX === b.oldX && a.x <= b.x) ? [a, b] : [b, a];
    const penetration = width - (right.x - left.x);
    const leftTravel = Math.max(0, left.x - left.oldX);
    const rightTravel = Math.max(0, right.oldX - right.x);
    const total = leftTravel + rightTravel;
    const share = total > EPSILON ? leftTravel / total : 0.5;
    const leftRoom = left.x - (RULES.left + HALF_BODY);
    const rightRoom = RULES.right - HALF_BODY - right.x;
    // Undo inward travel. Walking into a stationary defender does not push them.
    const retract = clamp(penetration * share, Math.max(0, penetration - rightRoom), Math.min(penetration, leftRoom));
    left.x -= retract;
    right.x += penetration - retract;
    if (left.vx > 0) left.vx = 0;
    if (right.vx < 0) right.vx = 0;
    if (left.shove > 0) left.shove = 0;
    if (right.shove < 0) right.shove = 0;
  }

  const POSTS = [RULES.left, RULES.right].map((edge, side) => {
    const minX = side === 0 ? edge - RADIUS * 2 : edge;
    const maxX = side === 0 ? edge : edge + RADIUS * 2;
    return [
      { minX, maxX, minY: RULES.ceiling, maxY: RULES.mouthTop },
      { minX, maxX, minY: RULES.mouthBottom, maxY: RULES.floor }
    ];
  });

  class Match {
    constructor() {
      /** @type {Phase} */
      this.phase = 'title';
      this.phaseAge = 0;
      this.liveTick = 0;
      this.clock = ticks(RULES.regulation);
      this.overtime = false;
      this.score = [0, 0];
      this.ready = [0, 0];
      this.fighters = [spawnFighter(0), spawnFighter(1)];
      this.puck = spawnPuck(0);
      /** @type {Gate[]} */
      this.gates = [{ owner: 0, until: 0 }, { owner: 1, until: 0 }];
      /** @type {MatchEvent[]} */
      this.events = [];
      this.openingDirection = -1;
      this.serveDirection = 1;
      this.launchDirection = 1;
      this.faceoffDuration = 0;
      this.scorer = -1;
      this.winner = -1;
      this.lastClang = -100;
      this.lastRail = -100;
    }

    /** @param {Phase} phase */
    setPhase(phase) {
      this.phase = phase;
      this.phaseAge = 0;
    }

    /** @param {Cue} cue @param {number} x @param {number} y @param {number} [side] */
    emit(cue, x, y, side = -1) {
      this.events.push({ cue, x, y, side });
    }

    /** @param {number} side */
    gateOpen(side) { return this.gates[side].until > this.liveTick; }

    start() {
      this.score = [0, 0];
      this.ready = [0, 0];
      this.overtime = false;
      this.clock = ticks(RULES.regulation);
      this.liveTick = 0;
      this.lastClang = -100;
      this.lastRail = -100;
      this.winner = -1;
      this.scorer = -1;
      this.openingDirection *= -1;
      this.serveDirection = this.openingDirection;
      this.faceoff(RULES.opening);
    }

    /** @param {number} seconds */
    faceoff(seconds) {
      this.fighters = [spawnFighter(0), spawnFighter(1)];
      this.puck = spawnPuck(this.liveTick);
      for (const gate of this.gates) gate.until = 0;
      this.faceoffDuration = ticks(seconds);
      this.setPhase('faceoff');
    }

    /** @param {number} direction */
    launch(direction) {
      const angle = radians(RULES.serveAngle);
      this.puck.vx = direction * RULES.serveSpeed * Math.cos(angle);
      this.puck.vy = RULES.serveSpeed * Math.sin(angle);
      this.puck.stillSince = this.liveTick;
      this.launchDirection = direction;
      this.setPhase('live');
      this.emit('serve', this.puck.x, this.puck.y);
    }

    /** @param {PlayerInput[]} input */
    join(input) {
      for (const [side, controls] of input.entries()) {
        this.ready[side] = Math.max(0, this.ready[side] - 1);
        if (controls.start) {
          if (!this.ready[side]) this.emit('ready', 0, 0, side);
          this.ready[side] = ticks(RULES.readyTimeout);
        }
      }
      if (this.ready.every(Boolean)) this.start();
    }

    /** @param {PlayerInput[]} input */
    step(input) {
      this.phaseAge++;
      switch (this.phase) {
        case 'title':
          this.join(input);
          break;
        case 'faceoff':
          if (this.faceoffDuration - this.phaseAge === RULES.hz) this.emit('count', 0, 0);
          if (this.phaseAge >= this.faceoffDuration) {
            this.launch(this.serveDirection);
            this.serveDirection *= -1;
          }
          break;
        case 'live':
          this.playTick(input);
          break;
        case 'goal':
          if (this.phaseAge >= ticks(RULES.goalCue)) {
            if (this.overtime || this.score[this.scorer] >= RULES.goalsToWin) this.finish(this.scorer);
            else if (this.clock === 0) this.expire();
            else this.faceoff(RULES.faceoff);
          }
          break;
        case 'repair':
          this.clock = Math.max(0, this.clock - 1);
          if (this.clock === 0) this.expire();
          else if (this.phaseAge >= ticks(RULES.repair)) this.launch(-this.launchDirection);
          break;
        case 'result':
          if (this.phaseAge >= ticks(RULES.resultLock) && input.some(controls => controls.start)) {
            this.returnToTitle();
            this.join(input);
          } else if (this.phaseAge >= ticks(RULES.resultTimeout)) {
            this.returnToTitle();
          }
          break;
      }
    }

    returnToTitle() {
      this.ready = [0, 0];
      this.faceoff(RULES.opening);
      this.setPhase('title');
    }

    /** @param {number} winner */
    finish(winner) {
      this.winner = winner;
      this.setPhase('result');
      this.emit('result', 0, 0, winner);
    }

    expire() {
      if (this.score[0] !== this.score[1]) {
        this.finish(this.score[0] > this.score[1] ? 0 : 1);
      } else if (this.overtime) {
        this.finish(-1);
      } else {
        this.overtime = true;
        this.clock = ticks(RULES.overtime);
        this.faceoff(RULES.opening);
      }
    }

    /** @param {PlayerInput[]} input */
    playTick(input) {
      this.liveTick++;
      for (const gate of this.gates) {
        if (gate.until - this.liveTick === ticks(1)) {
          this.emit('warning', gate.owner === 0 ? RULES.left : RULES.right, GOAL_Y, gate.owner);
        }
      }
      for (const [side, fighter] of this.fighters.entries()) moveFighter(fighter, input[side], this.liveTick);
      resolveFighters(this.fighters);
      const puck = this.puck;
      const escaped = puckOutside(puck);
      this.resolveStrikes(!escaped);
      puck.oldX = puck.x;
      puck.oldY = puck.y;
      const goalOwner = escaped ? -1 : this.movePuck();
      this.clock = Math.max(0, this.clock - 1);
      if (goalOwner !== -1) {
        this.scorer = 1 - goalOwner;
        this.score[this.scorer]++;
        this.emit('goal', puck.x, puck.y, this.scorer);
        this.setPhase('goal');
      } else if (this.clock === 0) {
        this.expire();
      } else if (this.puckNeedsRepair()) {
        this.puck = spawnPuck(this.liveTick);
        this.setPhase('repair');
      }
    }

    /** @param {boolean} puckPlayable */
    resolveStrikes(puckPlayable = true) {
      const now = this.liveTick;
      const candidates = this.fighters.map((fighter, side) => {
        const swing = fighter.swing;
        if (!swing || now - swing.at < HIT_START || now - swing.at >= HIT_END) return null;
        if (now - swing.at === HIT_START) this.emit('swing', fighter.x, fighter.y, side);
        const target = this.fighters[1 - side];
        const area = strikeBox(fighter);
        const hit = !swing.fighter && now >= target.protectedUntil && overlaps(area, bodyBox(target));
        const shot = puckPlayable && !swing.puck && circleContact(this.puck, area) !== null;
        if (hit) swing.fighter = true;
        if (shot) swing.puck = true;
        return { hit, shot, face: fighter.face, ground: fighter.grounded };
      });
      for (const [side, candidate] of candidates.entries()) {
        if (candidate?.hit) this.acceptHit(side, candidate.face);
      }
      if (candidates.every(candidate => candidate?.shot)) {
        this.emit('clash', this.puck.x, this.puck.y);
        return;
      }
      for (const [side, candidate] of candidates.entries()) {
        if (!candidate?.shot) continue;
        const angle = radians(candidate.ground ? RULES.groundShot : RULES.airShot);
        const puck = this.puck;
        puck.vx = candidate.face * Math.cos(angle) * RULES.shotSpeed;
        puck.vy = Math.sin(angle) * RULES.shotSpeed;
        puck.shooter = side;
        puck.powerUntil = now + ticks(FEEL.trail);
        puck.stillSince = now;
        puck.watched = { minX: puck.x, maxX: puck.x, minY: puck.y, maxY: puck.y };
        this.emit('shot', puck.x, puck.y, side);
      }
    }

    /** @param {number} attacker @param {number} face */
    acceptHit(attacker, face) {
      const target = this.fighters[1 - attacker];
      const now = this.liveTick;
      target.pips++;
      target.stunned = target.pips === 3;
      if (target.stunned) target.pips = 0;
      target.decayAt = now + ticks(RULES.pipDecay);
      target.blockedUntil = now + ticks(target.stunned ? RULES.stun : RULES.recoil);
      target.protectedUntil = target.blockedUntil + ticks(RULES.protection);
      target.swing = null;
      target.jumpUntil = -1;
      target.strikeUntil = -1;
      target.shove = face * RULES.shove;
      this.emit('hit', target.x, target.y - 28, attacker);
      if (!this.gateOpen(target.side)) {
        this.gates[target.side].until = now + ticks(RULES.open);
        this.emit('unlock', target.side === 0 ? RULES.left : RULES.right, GOAL_Y, target.side);
      }
    }

    /** @param {number} oldX @param {number} oldY */
    resolveRink(oldX, oldY) {
      const puck = this.puck;
      if (puck.y < RULES.ceiling + RADIUS || puck.y > RULES.floor - RADIUS) {
        const normal = puck.y < RULES.ceiling + RADIUS ? 1 : -1;
        puck.y = clamp(puck.y, RULES.ceiling + RADIUS, RULES.floor - RADIUS);
        if (reflect(puck, 0, normal) && this.liveTick - this.lastRail >= ticks(0.16)) {
          this.lastRail = this.liveTick;
          this.emit('rail', puck.x, puck.y);
        }
      }
      for (const gate of this.gates) {
        const side = gate.owner;
        const edge = side === 0 ? RULES.left : RULES.right;
        const inward = side === 0 ? 1 : -1;
        const reach = (puck.x - edge) * inward;
        if (reach >= RADIUS) continue;

        if (this.gateOpen(side)) {
          const post = circleContact(puck, POSTS[side][puck.y < GOAL_Y ? 0 : 1]);
          if (post) {
            separate(puck, post);
            reflect(puck, post.x, post.y);
            // A rim contact ends this attempt even if the corner normal points down.
            reflect(puck, inward, 0);
            if ((puck.x - edge) * inward < RADIUS) puck.x = edge + RADIUS * inward;
          } else if ((oldX - edge) * inward >= 0 && reach <= 0 && puck.vx * inward < 0) {
            const ratio = clamp((edge - oldX) / (puck.x - oldX || EPSILON), 0, 1);
            const atY = oldY + (puck.y - oldY) * ratio;
            if (atY >= RULES.mouthTop + RADIUS && atY <= RULES.mouthBottom - RADIUS) {
              puck.x = edge;
              puck.y = atY;
              return side;
            }
          }
          if ((puck.x - edge) * inward >= 0) continue;
        }
        puck.x = edge + RADIUS * inward;
        if (reflect(puck, inward, 0) && this.liveTick - this.lastClang >= ticks(0.12)) {
          this.lastClang = this.liveTick;
          this.emit('clang', puck.x, puck.y, side);
        }
      }
      return -1;
    }

    movePuck() {
      const puck = this.puck;
      capPuckSpeed(puck);
      for (let part = 1; part <= RULES.puckSubsteps; part++) {
        const oldX = puck.x;
        const oldY = puck.y;
        puck.x += puck.vx * STEP / RULES.puckSubsteps;
        puck.y += puck.vy * STEP / RULES.puckSubsteps;
        const goalOwner = this.resolveRink(oldX, oldY);
        if (goalOwner !== -1) return goalOwner;
        const fraction = part / RULES.puckSubsteps;
        const boxes = this.fighters.map(fighter => {
          const box = bodyBox(fighter);
          const dx = (fighter.oldX - fighter.x) * (1 - fraction);
          const dy = (fighter.oldY - fighter.y) * (1 - fraction);
          box.minX += dx;
          box.maxX += dx;
          box.minY += dy;
          box.maxY += dy;
          return box;
        });
        this.resolveBodies(boxes);
      }
      return -1;
    }

    /** @param {Box[]} boxes */
    resolveBodies(boxes) {
      const puck = this.puck;
      if (puck.shooter !== -1 && !circleContact(puck, boxes[puck.shooter])) puck.shooter = -1;
      const contacts = boxes.map((box, side) => side === puck.shooter ? null : circleContact(puck, box));
      const [first, second] = contacts;
      if (!first && !second) return;
      let bounced = false;
      if (first && second) {
        const nx = first.x + second.x;
        const ny = first.y + second.y;
        const length = Math.hypot(nx, ny);
        if (length > EPSILON) {
          const normalX = nx / length;
          const normalY = ny / length;
          const depth = Math.max(first.depth, second.depth) / Math.max(0.25, normalX * first.x + normalY * first.y);
          separate(puck, { x: normalX, y: normalY, depth });
          bounced = reflect(puck, normalX, normalY);
        } else {
          puck.vx *= -1;
          puck.vy *= -1;
          bounced = true;
        }
      } else {
        const contact = first || second;
        if (!contact) return;
        separate(puck, contact);
        bounced = reflect(puck, contact.x, contact.y);
      }
      // Separation stays a radius inside the rink. A goal requires actual outward flight.
      puck.x = clamp(puck.x, RULES.left + RADIUS, RULES.right - RADIUS);
      puck.y = clamp(puck.y, RULES.ceiling + RADIUS, RULES.floor - RADIUS);
      const solidBodies = puck.shooter === -1 ? boxes : [boxes[1 - puck.shooter]];
      if (solidBodies.some(box => circleContact(puck, box))) {
        bounced = this.releasePuck(solidBodies) || bounced;
      }
      if (bounced) steadyPuck(puck);
    }

    /** @param {Box[]} boxes */
    releasePuck(boxes) {
      const puck = this.puck;
      const x = puck.x;
      const y = puck.y;
      const padding = RADIUS + EPSILON;
      const candidates = boxes.flatMap(box => [
        { x, y: box.minY - padding, nx: 0, ny: -1 },
        { x, y: box.maxY + padding, nx: 0, ny: 1 },
        { x: box.minX - padding, y, nx: -1, ny: 0 },
        { x: box.maxX + padding, y, nx: 1, ny: 0 }
      ]).filter(point => point.x >= RULES.left + RADIUS && point.x <= RULES.right - RADIUS
        && point.y >= RULES.ceiling + RADIUS && point.y <= RULES.floor - RADIUS
        && !boxes.some(box => circleContact({ ...point, vx: puck.vx, vy: puck.vy }, box)));
      candidates.sort((a, b) => {
        const distance = Math.hypot(a.x - x, a.y - y) - Math.hypot(b.x - x, b.y - y);
        if (Math.abs(distance) > EPSILON) return distance;
        return (b.x - a.x) * puck.vx + (b.y - a.y) * puck.vy;
      });
      const exit = candidates[0];
      if (!exit) return false;
      puck.x = exit.x;
      puck.y = exit.y;
      return reflect(puck, exit.nx, exit.ny);
    }

    puckNeedsRepair() {
      const puck = this.puck;
      if (puckOutside(puck)) return true;

      const bounds = puck.watched;
      bounds.minX = Math.min(bounds.minX, puck.x);
      bounds.maxX = Math.max(bounds.maxX, puck.x);
      bounds.minY = Math.min(bounds.minY, puck.y);
      bounds.maxY = Math.max(bounds.maxY, puck.y);
      if (bounds.maxX - bounds.minX > RULES.stuckSpan || bounds.maxY - bounds.minY > RULES.stuckSpan) {
        puck.stillSince = this.liveTick;
        puck.watched = { minX: puck.x, maxX: puck.x, minY: puck.y, maxY: puck.y };
      }
      return this.liveTick - puck.stillSince >= ticks(RULES.stuckTime);
    }
  }

  /** @type {Record<Cue, [number, number, number, number, OscillatorType]>} */
  const ARCADE_CUES = {
    hit: [210, 72, 0.095, 0.18, 'triangle'],
    unlock: [523, 659, 0.08, 0.11, 'square'],
    shot: [920, 300, 0.11, 0.11, 'square'],
    clang: [930, 410, 0.08, 0.095, 'triangle'],
    serve: [880, 1320, 0.13, 0.14, 'square'],
    goal: [523, 523, 0.14, 0.16, 'square'],
    clash: [470, 115, 0.14, 0.13, 'triangle'],
    warning: [740, 740, 0.075, 0.11, 'square'],
    rail: [320, 170, 0.047, 0.065, 'triangle'],
    ready: [392, 523, 0.09, 0.10, 'square'],
    count: [440, 440, 0.10, 0.10, 'square'],
    result: [392, 392, 0.15, 0.13, 'square'],
    swing: [530, 180, 0.046, 0.045, 'triangle']
  };
  const MUSIC_STEP = 60 / 144 / 4;
  // Eight bars in A minor. Melody uses eighth notes, with held notes marked by a dash.
  const MUSIC = [
    { bass: 45, chord: [57, 60, 64], lead: [76, 76, 79, 81, 79, 76, 72, -1] },
    { bass: 41, chord: [53, 57, 60], lead: [72, 77, 76, 72, 69, 72, 74, -1] },
    { bass: 48, chord: [55, 60, 64], lead: [76, 79, 84, 79, 76, 74, 72, 74] },
    { bass: 43, chord: [55, 59, 62], lead: [74, 79, 77, 74, 71, 74, 76, -1] },
    { bass: 45, chord: [57, 60, 64], lead: [81, 81, 84, 81, 79, 76, 79, -1] },
    { bass: 41, chord: [53, 57, 60], lead: [77, 76, 72, 77, 81, 79, 76, -1] },
    { bass: 50, chord: [57, 62, 65], lead: [77, 81, 86, 84, 81, 77, 74, 77] },
    { bass: 40, chord: [56, 59, 64], lead: [76, 80, 83, 80, 76, 74, 71, 76] }
  ];
  const BASS_RHYTHM = [0, -1, 0, 12, -1, 0, -1, 7, 0, -1, 0, 12, -1, 7, 12, -1];
  const noteHz = (/** @type {number} */ midi) => 440 * 2 ** ((midi - 69) / 12);

  class ArenaSound {
    constructor() {
      /** @type {AudioContext | null} */
      this.context = null;
      /** @type {DynamicsCompressorNode | null} */
      this.output = null;
      /** @type {GainNode | null} */
      this.music = null;
      /** @type {AudioBuffer | null} */
      this.noise = null;
      this.step = 0;
      this.nextBeat = 0;
      this.duckUntil = 0;
      this.musicLevel = -1;
      this.resumePending = false;
    }

    unlock() {
      if (typeof AudioContext === 'undefined') return;
      try {
        if (!this.context) {
          const audio = new AudioContext();
          this.context = audio;
          this.output = audio.createDynamicsCompressor();
          this.output.threshold.value = -17;
          this.output.ratio.value = 5;
          this.output.connect(audio.destination);
          this.music = audio.createGain();
          this.music.gain.value = 0;
          this.music.connect(this.output);
          this.noise = audio.createBuffer(1, Math.ceil(audio.sampleRate * 0.18), audio.sampleRate);
          const samples = this.noise.getChannelData(0);
          for (let i = 0; i < samples.length; i++) samples[i] = Math.random() * 2 - 1;
        }
        if (this.context.state !== 'running' && !this.resumePending) {
          this.resumePending = true;
          this.context.resume().catch(() => {}).finally(() => { this.resumePending = false; });
        }
      } catch {
        // The match stays playable when the browser denies audio.
      }
    }

    /** @param {Phase} phase @param {boolean} paused */
    update(phase, paused) {
      const audio = this.context;
      const music = this.music;
      if (audio?.state !== 'running' || !music) return;
      const now = audio.currentTime;
      const playing = !paused && phase !== 'result';
      const level = !playing ? 0 : now < this.duckUntil ? 0.12 : phase === 'live' ? 0.57 : 0.32;
      if (level !== this.musicLevel) {
        music.gain.setTargetAtTime(level, now, level < this.musicLevel ? 0.018 : 0.075);
        this.musicLevel = level;
      }
      if (!playing) {
        this.nextBeat = 0;
        return;
      }
      // Drop missed steps after long stalls instead of scheduling an audible burst.
      if (this.nextBeat < now) this.nextBeat = now + 0.02;
      while (this.nextBeat < now + 0.15) {
        this.musicStep(audio, this.nextBeat, phase === 'live', music);
        this.nextBeat += MUSIC_STEP;
        this.step = (this.step + 1) % (MUSIC.length * 16);
      }
    }

    /** @param {AudioContext} audio @param {number} at @param {boolean} live @param {GainNode} bus */
    musicStep(audio, at, live, bus) {
      const index = this.step % 16;
      const bar = MUSIC[Math.floor(this.step / 16)];
      const bass = BASS_RHYTHM[index];
      if (bass >= 0) {
        const hz = noteHz(bar.bass + bass);
        this.note(audio, at, hz, hz, MUSIC_STEP * 1.5, 0.12, 'triangle', bus);
      }
      if (index % 2 === 0) {
        const midi = bar.lead[index / 2];
        if (midi >= 0) {
          const hz = noteHz(midi);
          const length = MUSIC_STEP * (bar.lead[index / 2 + 1] === -1 ? 3.3 : 1.45);
          this.note(audio, at, hz, hz, length, 0.038, 'square', bus);
        }
      }
      if (index % 4 === 2 || (live && index % 4 === 3)) {
        const hz = noteHz(bar.chord[Math.floor(index / 2) % 3] + 12);
        this.note(audio, at, hz, hz, MUSIC_STEP * 0.64, 0.035, 'triangle', bus);
      }
      if (index % 4 === 0 || (live && index === 10)) {
        this.note(audio, at, 125, 47, 0.10, 0.16, 'sine', bus);
      }
      if (index % 8 === 4) this.burst(audio, at, 0.095, 0.105, 1300, bus);
      if (index % 2 === 0 || (live && index >= 13)) {
        this.burst(audio, at, 0.036, index % 4 === 2 ? 0.052 : 0.028, 6200, bus);
      }
    }

    /** @param {Cue} cue */
    play(cue) {
      const audio = this.context;
      if (audio?.state !== 'running') return;
      const [from, to, length, volume, wave] = ARCADE_CUES[cue];
      const now = audio.currentTime;
      this.note(audio, now, from, to, length, volume, wave);
      if (cue === 'hit' || cue === 'shot' || cue === 'clang' || cue === 'clash') {
        this.burst(audio, now, 0.065, 0.15, cue === 'hit' ? 530 : 1600, this.output ?? audio.destination);
        this.duckUntil = Math.max(this.duckUntil, now + 0.15);
      }
      const extra = cue === 'goal' ? [659, 784, 1047]
        : cue === 'result' ? [523, 659, 784]
        : cue === 'unlock' ? [784, 1047]
        : cue === 'serve' ? [1320] : [];
      extra.forEach((hz, index) => {
        const start = now + (index + 1) * 0.078;
        this.note(audio, start, hz, hz, index === extra.length - 1 ? 0.24 : 0.11, 0.105, 'square');
      });
      if (extra.length) this.duckUntil = Math.max(this.duckUntil, now + 0.34 + extra.length * 0.078);
      else if (cue === 'warning' || cue === 'count') this.duckUntil = Math.max(this.duckUntil, now + 0.17);
    }

    /** @param {AudioContext} audio @param {number} at @param {number} duration
     * @param {number} volume @param {number} frequency @param {AudioNode} output */
    burst(audio, at, duration, volume, frequency, output) {
      if (!this.noise) return;
      const source = audio.createBufferSource();
      source.buffer = this.noise;
      const filter = audio.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.value = frequency;
      filter.Q.value = 0.7;
      const gain = audio.createGain();
      gain.gain.setValueAtTime(volume, at);
      gain.gain.exponentialRampToValueAtTime(0.001, at + duration);
      source.connect(filter).connect(gain).connect(output);
      source.onended = () => { source.disconnect(); filter.disconnect(); gain.disconnect(); };
      source.start(at);
      source.stop(at + duration);
    }

    /** @param {AudioContext} audio @param {number} now @param {number} from @param {number} to
     * @param {number} length @param {number} volume @param {OscillatorType} type @param {AudioNode} [output] */
    note(audio, now, from, to, length, volume, type, output = this.output ?? audio.destination) {
      const voice = audio.createOscillator();
      const gain = audio.createGain();
      voice.type = type;
      voice.frequency.setValueAtTime(from, now);
      voice.frequency.exponentialRampToValueAtTime(to, now + length);
      gain.gain.setValueAtTime(0.001, now);
      gain.gain.linearRampToValueAtTime(volume, now + 0.005);
      gain.gain.exponentialRampToValueAtTime(0.001, now + length);
      voice.connect(gain).connect(output);
      voice.onended = () => { voice.disconnect(); gain.disconnect(); };
      voice.start(now);
      voice.stop(now + length);
    }

    close() {
      this.context?.close().catch(() => {});
      this.context = null;
      this.output = null;
      this.music = null;
      this.noise = null;
      this.nextBeat = 0;
      this.step = 0;
      this.duckUntil = 0;
      this.musicLevel = -1;
      this.resumePending = false;
    }
  }

  /** @param {Phaser.GameObjects.Graphics} g */
  function drawRink(g) {
    const { left, right, ceiling, floor, width, height } = RULES;
    g.fillStyle(0x0b1220).fillRect(0, 0, width, height);
    g.fillStyle(0x111f31).fillRect(0, 115, width, ceiling - 115);
    for (let row = 0; row < 4; row++) {
      const y = 147 + row * 19;
      g.fillStyle(0x0d1726).fillRect(0, y + 12, width, 6);
      for (let column = 0; column < 53; column++) {
        const x = column * 16 + (row % 2) * 7;
        const tone = (column * 13 + row * 7) % 11;
        g.fillStyle(tone < 2 ? 0x35465c : 0x223247);
        g.fillCircle(x, y, 2 + tone % 2).fillRect(x - 4, y + 3, 8, 5);
      }
    }
    for (const side of [0, 1]) {
      const x = side === 0 ? 78 : width - 78;
      const direction = side === 0 ? 1 : -1;
      g.fillStyle(0x8ba9c9, 0.08).fillTriangle(x - 24, 127, x + 24, 127, x + direction * 152, 223);
      g.lineStyle(4, 0x42566f).lineBetween(x, 130, x + direction * 31, 223);
      g.fillStyle(0x253751).fillRoundedRect(x - 31, 117, 62, 14, 3);
      for (let lamp = -23; lamp <= 23; lamp += 15) g.fillStyle(0xaac9df).fillRect(x + lamp, 120, 11, 5);
    }
    g.fillStyle(0x090f1b).fillRoundedRect(left - 11, ceiling - 11, right - left + 22, floor - ceiling + 30, 11);
    g.fillStyle(0x35465b).fillRect(left, ceiling - 6, right - left, 7);
    const bands = [0x202e43, 0x223148, 0x24344c, 0x26364d, 0x273950, 0x293b52];
    bands.forEach((color, index) => {
      const y = ceiling + Math.floor((floor - ceiling) * index / bands.length);
      const end = ceiling + Math.floor((floor - ceiling) * (index + 1) / bands.length);
      g.fillStyle(color).fillRect(left, y, right - left, end - y);
    });
    g.lineStyle(1, 0x728ca6, 0.15);
    for (let x = left + 87; x < right; x += 87) g.lineBetween(x, ceiling + 1, x, floor - 1);
    g.lineStyle(2, 0x8ba9bd, 0.29);
    g.lineBetween(CENTER_X, ceiling, CENTER_X, floor);
    g.strokeCircle(CENTER_X, CENTER_Y, 49);
    g.fillStyle(0x9db0c8, 0.44).fillCircle(CENTER_X, CENTER_Y, 3);
    for (const [side, edge] of [left, right].entries()) {
      const inward = side === 0 ? 1 : -1;
      const x = Math.min(edge, edge + inward * 84);
      g.fillStyle(TEAM[side], 0.055).fillRect(x, RULES.mouthTop, 84, RULES.mouthBottom - RULES.mouthTop);
      g.lineStyle(2, TEAM[side], 0.22).strokeRect(x, RULES.mouthTop, 84, RULES.mouthBottom - RULES.mouthTop);
      for (const y of [ceiling + 17, floor - 17]) {
        g.lineStyle(2, TEAM[side], 0.42).lineBetween(edge + inward * 7, y, edge + inward * 41, y);
      }
    }
    g.fillStyle(0x93a8bf).fillRect(left, floor, right - left, 2);
    g.fillStyle(0x3b506a).fillRect(left, floor + 2, right - left, 6);
    g.fillStyle(0x172538).fillRect(left, floor + 8, right - left, 7);
    for (let x = left + 16; x < right; x += 28) g.fillStyle(0x526981).fillCircle(x, floor + 11, 1);
    g.fillStyle(0x111c2d).fillRect(0, 528, width, height - 528);
    g.lineStyle(1, 0x394e67).lineBetween(33, 528, 767, 528);
  }

  /** @param {Phaser.GameObjects.Graphics} g @param {Fighter} fighter
   * @param {number} now @param {number} alpha @param {number} visualTime */
  function drawFighter(g, fighter, now, alpha, visualTime) {
    const x = Phaser.Math.Linear(fighter.oldX, fighter.x, alpha);
    const y = Phaser.Math.Linear(fighter.oldY, fighter.y, alpha);
    const color = TEAM[fighter.side];
    const dark = fighter.side === 0 ? 0x237189 : 0xa84d37;
    const face = fighter.face;
    const age = fighter.swing ? now - fighter.swing.at : -1;
    const active = age >= HIT_START && age < HIT_END;
    const winding = age >= 0 && age < HIT_START;
    const poseAge = Math.max(0, age - 1 + alpha);
    const stunned = fighter.stunned && now < fighter.blockedUntil;
    const protectedNow = now < fighter.protectedUntil && now >= fighter.blockedUntil;
    const run = clamp(Math.abs(fighter.vx) / RULES.groundSpeed, 0, 1);
    const stride = fighter.grounded ? Math.sin((now - 1 + alpha) / 6) * 8 * run : 0;
    const idle = fighter.grounded && age < 0 && !stunned ? Math.sin(visualTime / 225 + fighter.side) * (1 - run) : 0;
    const tuck = fighter.grounded ? 0 : clamp(4 - fighter.vy / 180, 1, 8);
    const crouch = stunned ? 6 : winding ? 3 * poseAge / HIT_START : 0;
    const top = y - 52 + crouch + idle;
    const hitAge = ticks(fighter.stunned ? RULES.stun : RULES.recoil) - (fighter.blockedUntil - now);
    const flash = now < fighter.blockedUntil ? 1 - clamp(hitAge / ticks(FEEL.hitFlash), 0, 1) : 0;

    /** @param {number} tint @param {number[]} points */
    const patch = (tint, points) => {
      const vertices = [];
      for (let i = 0; i < points.length; i += 2) vertices.push({ x: x + face * points[i], y: top + points[i + 1] });
      g.fillStyle(tint).fillPoints(vertices, true);
    };
    g.fillStyle(0x080d17, 0.55 - tuck * 0.025).fillEllipse(x, RULES.floor - 1, 36 - tuck, 6);

    if (active) {
      const box = strikeBox(fighter);
      const centerY = y - RULES.fighterHeight + RULES.strikeOffset;
      const root = x + face * HALF_BODY;
      const end = x + (face > 0 ? box.maxX : box.minX) - fighter.x;
      g.fillStyle(color, 0.2).fillTriangle(root, centerY - 12, end, centerY, root, centerY + 12);
      g.lineStyle(2, WHITE, 0.92).lineBetween(root + face * 5, centerY, end, centerY);
      g.lineStyle(2, color, 0.8).lineBetween(root, centerY + 7, end - face * 10, centerY + 4);
    }
    if (protectedNow) {
      g.lineStyle(2, color, 0.68).strokeRoundedRect(x - 18, y - 56, 36, 56, 7);
      for (let stripe = 0; stripe < 3; stripe++) {
        const py = y - 45 + stripe * 12;
        g.lineBetween(x - 19, py, x - 13, py - 5);
        g.lineBetween(x + 13, py, x + 19, py - 5);
      }
    }

    const rear = y - tuck * 0.75 - Math.max(0, stride) * 0.45;
    const front = y - tuck + Math.min(0, stride) * 0.45;
    const backX = x - face * (7 + stride * 0.45);
    const frontX = x + face * (7 - stride * 0.45);
    g.lineStyle(8, 0x101725).lineBetween(x - face * 6, y - 19, backX, rear - 5);
    g.lineStyle(6, dark).lineBetween(x - face * 6, y - 18, backX, rear - 6);
    g.lineStyle(8, 0x101725).lineBetween(x + face * 5, y - 19, frontX, front - 4);
    g.lineStyle(6, 0x4f6680).lineBetween(x + face * 5, y - 18, frontX, front - 5);
    for (const [bootX, footY] of [[backX, rear], [frontX, front]]) {
      g.fillStyle(0x090f1b).fillRoundedRect(bootX - 5 + face * 2, footY - 7, 11, 7, 2);
      g.fillStyle(color).fillRect(bootX - 4 + face * 2, footY - 6, 9, 2);
    }

    patch(0x0a1120, [-13, 18, 10, 17, 15, 23, 10, 36, -10, 36, -16, 25]);
    patch(flash > 0.32 ? WHITE : color, [-11, 19, 9, 19, 12, 23, 8, 33, -9, 33, -13, 25]);
    patch(dark, [-13, 24, -7, 24, -3, 34, -10, 34]);
    patch(WHITE, [1, 21, 9, 21, 8, 24, 0, 24]);
    patch(0x111c2b, [-9, 34, 9, 34, 8, 37, -8, 37]);

    if (fighter.side === 0) {
      const flick = stride * 0.19 + tuck * 0.35;
      patch(0x090f1b, [-6, 5, -14, 2, -20, 8 + flick, -22, 16 + flick, -14, 13 + flick, -8, 10]);
      patch(color, [-8, 4, -13, 5, -13, 8, -8, 8]);
    } else {
      patch(0x090f1b, [-13, 10, -14, 3, -8, 4, -6, -2, -2, 2, 3, -2, 9, 5, 11, 12]);
      patch(color, [-10, 4, -6, 0, -3, 4, 3, 0, 7, 6, -7, 7]);
    }
    patch(0x090f1b, [-10, 6, 6, 5, 12, 11, 10, 17, 4, 20, -8, 16]);
    patch(fighter.side === 0 ? 0xf3bd91 : 0xbd805e, [-4, 8, 7, 8, 10, 12, 7, 17, 1, 17, -4, 14]);
    patch(dark, [-9, 6, 6, 5, 9, 9, 2, 10, -8, 12]);
    patch(0x101725, [4, 10, 9, 10, 9, 12, 4, 12]);
    patch(WHITE, [6, 10, 9, 10, 8, 11, 6, 11]);

    let reach = 13 + stride * 0.3;
    if (winding) reach = Phaser.Math.Linear(13, 7, poseAge / HIT_START);
    else if (active) reach = Phaser.Math.Linear(7, 34, clamp((poseAge - HIT_START + 1) / 3, 0, 1));
    else if (age >= HIT_END) reach = Phaser.Math.Linear(34, 13, (poseAge - HIT_END + 1) / (SWING_END - HIT_END));
    const gloveX = x + face * reach;
    const gloveY = top + (active ? 20 : 25 - stride * 0.3);
    g.lineStyle(7, 0x0a1120).lineBetween(x + face * 7, top + 23, gloveX, gloveY);
    g.lineStyle(4, dark).lineBetween(x + face * 8, top + 23, gloveX, gloveY);
    g.fillStyle(0x0a1120).fillRoundedRect(gloveX - 6, gloveY - 6, 12, 12, 3);
    g.fillStyle(color).fillRoundedRect(gloveX - 4, gloveY - 4, 8, 8, 2);
    g.fillStyle(WHITE).fillRect(gloveX - 3, gloveY - 3, 5, 2);
    if (stunned) {
      for (const offset of [-10, 7]) {
        g.fillStyle(GOLD).fillTriangle(x + offset - 3, y - 61, x + offset + 4, y - 63, x + offset, y - 57);
      }
    }
  }

  /** @param {Phaser.Scene} scene @param {number} x @param {number} y @param {number} size
   * @param {string} [color] */
  function label(scene, x, y, size, color = '#f7faff') {
    return scene.add.text(x, y, '', {
      fontFamily: 'Arial, sans-serif', fontSize: size, color, fontStyle: 'bold',
      align: 'center'
    }).setOrigin(0.5);
  }

  /** @param {Phaser.GameObjects.Text} object @param {string} value */
  function showText(object, value) {
    if (object.text !== value) object.setText(value);
  }

  /** @param {Phaser.GameObjects.Graphics} g @param {number} x @param {number} y
   * @param {number} width @param {number} height @param {number} accent */
  function drawPlate(g, x, y, width, height, accent) {
    const cut = 10;
    const points = [
      { x: x + cut, y }, { x: x + width, y }, { x: x + width, y: y + height - cut },
      { x: x + width - cut, y: y + height }, { x, y: y + height }, { x, y: y + cut }
    ];
    g.fillStyle(0x101b2c, 0.98).fillPoints(points, true);
    g.lineStyle(1, accent, 0.4).strokePoints(points, true);
    g.lineStyle(3, accent, 0.9).lineBetween(x + cut, y, x + cut + Math.min(48, width / 3), y);
  }

  /** @typedef {MatchEvent & {duration: number, remaining: number}} Flash */

  /** @param {Phaser.GameObjects.Graphics} g @param {Flash} flash */
  function drawImpact(g, flash) {
    const age = 1 - flash.remaining / flash.duration;
    const color = flash.side < 0 ? WHITE : TEAM[flash.side];
    const goal = flash.cue === 'goal';
    const sparks = goal || flash.cue === 'hit' || flash.cue === 'shot' || flash.cue === 'clash';
    const radius = 7 + age * (goal ? 52 : 22);
    g.lineStyle(goal ? 3 : 2, color, (1 - age) * 0.8).strokeCircle(flash.x, flash.y, radius);
    if (goal) {
      const inward = flash.x < RULES.width / 2 ? 1 : -1;
      for (let shard = 0; shard < 7; shard++) {
        const x = flash.x + inward * (10 + age * (39 + shard * 8));
        const y = flash.y + (shard - 3) * (4 + age * 11);
        const size = (1 - age) * (shard % 2 ? 4 : 6);
        g.fillStyle(shard % 2 ? WHITE : color, (1 - age) * 0.85)
          .fillTriangle(x + inward * size * 2, y, x, y - size / 2, x, y + size / 2);
      }
    }
    if (sparks) {
      g.lineStyle(2, age < 0.23 ? WHITE : color, (1 - age) * 0.95);
      for (let ray = 0; ray < 5; ray++) {
        const angle = ray * Math.PI * 2 / 5;
        const dx = Math.cos(angle);
        const dy = Math.sin(angle);
        const start = radius + 3;
        const end = start + (1 - age) * (goal ? 15 : 9);
        g.lineBetween(flash.x + dx * start, flash.y + dy * start, flash.x + dx * end, flash.y + dy * end);
      }
    }
  }

  class HockeyScene extends Phaser.Scene {
    constructor() {
      super('hockey');
      this.match = new Match();
      this.cabinet = new CabinetInput();
      this.audioCues = new ArenaSound();
      /** @type {Flash[]} */
      this.flashes = [];
      /** @type {ReturnType<HockeyScene['createView']> | null} */
      this.view = null;
      this.accumulator = 0;
      this.suspended = false;
      this.resumeFor = 0;
      this.visualTime = 0;
    }

    createView() {
      const rinkKey = 'lorca-rink';
      if (!this.textures.exists(rinkKey)) {
        const art = this.make.graphics({ x: 0, y: 0 });
        drawRink(art);
        art.generateTexture(rinkKey, RULES.width, RULES.height);
        art.destroy();
      }
      const rink = this.add.image(0, 0, rinkKey).setOrigin(0);
      const actors = this.add.graphics();
      const meters = this.add.graphics();
      const scores = [label(this, 273, 57, 56, '#56dfff'), label(this, 527, 57, 56, '#ff9658')];
      const clock = label(this, 400, 54, 34);
      const mode = label(this, 400, 87, 15, '#b5c9e0');
      const stations = [
        label(this, 130, 52, 18, '#56dfff').setText('JUGADOR 1'),
        label(this, 670, 52, 18, '#ff9658').setText('JUGADOR 2')
      ];
      const status = [label(this, 130, 99, 13, '#ffe26a'), label(this, 670, 99, 13, '#ffe26a')];
      const gateText = [label(this, 115, 200, 18), label(this, 685, 200, 18)];
      const markers = [
        label(this, 0, 0, 13, '#56dfff').setText('J1').setStroke('#101725', 4),
        label(this, 0, 0, 13, '#ff9658').setText('J2').setStroke('#101725', 4)
      ];
      const guide = label(this, 400, 144, 19);
      const touch = window.matchMedia('(any-pointer: coarse)').matches;
      const controls = [
        label(this, 207, 550, 16, '#56dfff'),
        label(this, 593, 550, 16, '#ff9658')
      ];
      const cabinetHint = label(this, 400, 575, 16, '#b5c9e0')
        .setText(touch ? 'Usa los controles debajo de la cancha' : 'Arcade: palanca para moverte y saltar · 1 para pegar');
      const panel = this.add.graphics();
      const headline = label(this, 400, 0, 40);
      headline.setFontFamily('Arial Black, Arial, sans-serif').setFontStyle('bold italic');
      const detail = label(this, 400, 0, 18, '#d2e2f5');
      const titleStations = [
        label(this, 224, 249, 22, '#56dfff').setText('J1 · CELESTE · IZQ.'),
        label(this, 576, 249, 22, '#ff9658').setText('J2 · NARANJA · DER.')
      ];
      const titleControls = [
        label(this, 224, 320, 19).setLineSpacing(8),
        label(this, 576, 320, 19).setLineSpacing(8)
      ];
      const joinLabels = [label(this, 224, 405, 20, '#56dfff'), label(this, 576, 405, 20, '#ff9658')];
      const joinHint = label(this, 400, 549, 18, '#d2e2f5');
      return { rink, actors, meters, scores, clock, mode, stations, status, gateText, markers, guide, controls, cabinetHint, touch, arcadeStart: false,
        panel, headline, detail, titleStations, titleControls, joinLabels, joinHint };
    }

    create() {
      this.match = new Match();
      const view = this.createView();
      this.view = view;

      /** @param {KeyboardEvent} event */
      const press = (event) => {
        if (document.hidden || (event.isTrusted && event.defaultPrevented)) return;
        const key = cabinetKey(event);
        const code = this.cabinet.lookup.get(key);
        if (!code) return;
        if (code === PLAYER_INPUT[0].start || code === PLAYER_INPUT[1].start) {
          view.arcadeStart = event.isTrusted === false;
        }
        this.cabinet.keydown(event);
        if (!event.repeat) this.audioCues.unlock();
      };
      const pause = () => {
        this.suspended = true;
        this.accumulator = 0;
        this.cabinet.clear();
        this.audioCues.update(this.match.phase, true);
      };
      const resume = () => {
        if (!this.suspended) return;
        this.suspended = false;
        this.accumulator = 0;
        this.cabinet.clear();
        if (this.match.phase === 'live' || this.match.phase === 'repair') this.resumeFor = RULES.resume * 1000;
      };
      const visibility = () => { if (document.hidden) pause(); else resume(); };
      // The host's touch buttons live outside the iframe and can take focus mid-match.
      const blur = () => { if (document.hidden) pause(); else this.cabinet.clearPhysical(); };
      const canvas = this.game.canvas;
      canvas.tabIndex = 0;
      const focusCanvas = () => canvas.focus({ preventScroll: true });
      canvas.addEventListener('pointerdown', focusCanvas);
      window.addEventListener('keydown', press);
      window.addEventListener('keyup', this.cabinet.keyup);
      window.addEventListener('blur', blur);
      document.addEventListener('visibilitychange', visibility);
      visibility();
      this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
        window.removeEventListener('keydown', press);
        window.removeEventListener('keyup', this.cabinet.keyup);
        window.removeEventListener('blur', blur);
        document.removeEventListener('visibilitychange', visibility);
        canvas.removeEventListener('pointerdown', focusCanvas);
        this.cabinet.clear();
        this.audioCues.close();
        this.suspended = false;
        this.resumeFor = 0;
        this.accumulator = 0;
        this.flashes.length = 0;
        this.view = null;
      });
    }

    /** @param {number} time @param {number} delta */
    update(time, delta) {
      const safeDelta = clamp(delta, 0, TICK_CAP * STEP_MS);
      if (!this.suspended) this.visualTime += safeDelta;
      if (!this.suspended && this.resumeFor > 0) {
        this.resumeFor = Math.max(0, this.resumeFor - safeDelta);
        this.cabinet.edges.clear();
      } else if (!this.suspended) {
        this.accumulator += safeDelta;
        for (let step = 0; step < TICK_CAP && this.accumulator + EPSILON >= STEP_MS; step++) {
          this.match.step(this.cabinet.take());
          this.accumulator = Math.max(0, this.accumulator - STEP_MS);
        }
      }

      for (const flash of this.flashes) flash.remaining -= safeDelta;
      this.flashes = this.flashes.filter(flash => flash.remaining > 0);
      for (const event of this.match.events) {
        this.audioCues.play(event.cue);
        if (event.cue === 'hit' || event.cue === 'unlock' || event.cue === 'shot'
            || event.cue === 'goal' || event.cue === 'clash' || event.cue === 'clang') {
          if (this.flashes.length >= FEEL.maxFlashes) this.flashes.shift();
          const duration = event.cue === 'goal' ? FEEL.goalMs : FEEL.impactMs;
          this.flashes.push({ ...event, duration, remaining: duration });
        }
      }
      this.match.events.length = 0;
      this.audioCues.update(this.match.phase, this.suspended || this.resumeFor > 0);
      const alpha = this.match.phase === 'live' && !this.suspended && !this.resumeFor
        ? clamp(this.accumulator / STEP_MS, 0, 1) : 1;
      this.renderMatch(alpha);
    }

    /** @param {number} alpha */
    renderMatch(alpha) {
      const view = this.view;
      if (!view) return;
      const match = this.match;
      const g = view.actors.clear();
      const meters = view.meters.clear();
      const isTitle = match.phase === 'title';
      if (!isTitle) {
        drawPlate(meters, 29, 17, 282, 98, TEAM[0]);
        drawPlate(meters, 489, 17, 282, 98, TEAM[1]);
        drawPlate(meters, 327, 17, 146, 98, match.overtime ? GOLD : 0x87a0be);
      }
      let shakeX = 0;
      let shakeY = 0;
      let shakeStrength = 0;
      if (!isTitle && !this.suspended) {
        for (const flash of this.flashes) {
          const intensity = flash.cue === 'goal' ? FEEL.goalShake : flash.cue === 'hit' ? FEEL.hitShake : 0;
          const elapsed = flash.duration - flash.remaining;
          const strength = intensity * Math.max(0, 1 - elapsed / FEEL.shakeMs);
          if (strength <= shakeStrength) continue;
          shakeStrength = strength;
          shakeX = Math.round(strength * Math.cos(elapsed * 0.15) * (flash.side === 0 ? 1 : -1));
          shakeY = Math.round(strength * 0.5 * Math.sin(elapsed * 0.16));
        }
      }
      view.rink.setPosition(shakeX, shakeY);
      view.actors.setPosition(shakeX, shakeY);
      const seconds = Math.ceil(match.clock / RULES.hz);
      showText(view.clock.setVisible(!isTitle), Math.floor(seconds / 60) + ':' + String(seconds % 60).padStart(2, '0'));
      showText(view.mode.setVisible(!isTitle), match.overtime ? 'GOL DE ORO' : 'PRIMERO A ' + RULES.goalsToWin);
      this.renderGuide(view);
      if (!isTitle && view.guide.text) {
        const width = Math.max(220, view.guide.width + 32);
        const x = RULES.width / 2 - width / 2;
        meters.fillStyle(0x101b2c, 0.96).fillRoundedRect(x, 131, width, 30, 4);
        meters.lineStyle(1, 0x52718d, 0.65).strokeRoundedRect(x, 131, width, 30, 4);
      }

      for (const [side, gate] of match.gates.entries()) {
        const fighter = match.fighters[side];
        const edge = side === 0 ? RULES.left : RULES.right;
        const color = TEAM[side];
        const goalTime = gate.until - match.liveTick;
        const open = goalTime > 0 && !isTitle;
        const depth = RULES.goalDepth;
        const x = side === 0 ? edge - depth : edge;
        const goalHeight = RULES.mouthBottom - RULES.mouthTop;
        g.fillStyle(INK).fillRect(x, RULES.mouthTop, depth, goalHeight);
        g.fillStyle(color, open ? 0.28 : 0.14).fillRect(x, RULES.mouthTop, depth, goalHeight);
        g.lineStyle(1, color, 0.28);
        for (let y = RULES.mouthTop + 7; y < RULES.mouthBottom; y += 8) g.lineBetween(x, y, x + depth, y);
        for (let net = 6; net < depth; net += 6) {
          g.lineBetween(x + net, RULES.mouthTop + 1, x + net, RULES.mouthBottom - 1);
        }
        g.fillStyle(0x101725).fillRect(x - 2, RULES.mouthTop - 3, depth + 4, 3);
        g.fillStyle(color, 0.84).fillRect(x - 2, RULES.mouthTop - 1, depth + 4, 3);
        g.lineStyle(3, color).lineBetween(edge, RULES.ceiling, edge, RULES.mouthTop);
        g.lineBetween(edge, RULES.mouthBottom, edge, RULES.floor);
        g.strokeRect(x, RULES.mouthTop, depth, goalHeight);
        const shutter = open ? clamp((ticks(RULES.open) - goalTime) / ticks(FEEL.shutter), 0, 1) : 0;
        if (shutter < 1) {
          const offset = (side === 0 ? -1 : 1) * depth * shutter;
          g.lineStyle(3, color, 0.72 * (1 - shutter));
          for (let y = RULES.mouthTop + 5; y < RULES.mouthBottom - 4; y += 11) {
            g.lineBetween(x + offset, y, x + depth - 1 + offset, y + 5);
          }
        }
        const gateColor = open && goalTime <= RULES.hz ? '#ffe26a' : open ? '#f7faff' : '#a9bdd5';
        view.gateText[side].setVisible(!isTitle).setColor(gateColor);
        const gateLabel = 'ARCO J' + (side + 1);
        showText(view.gateText[side], gateLabel + (open ? ' ABIERTO · ' + Math.ceil(goalTime / RULES.hz) + ' s' : ' CERRADO'));
        const goalPulse = this.flashes.find(flash => flash.cue === 'goal' && flash.side === side);
        view.scores[side].setScale(goalPulse && match.phase === 'goal' ? 1 + 0.17 * goalPulse.remaining / goalPulse.duration : 1);
        showText(view.scores[side].setVisible(!isTitle), String(match.score[side]));
        view.stations[side].setVisible(!isTitle);
        const blocked = match.liveTick < fighter.blockedUntil;
        const stunned = fighter.stunned && blocked;
        const protectedNow = !blocked && match.liveTick < fighter.protectedUntil;
        showText(view.status[side].setVisible(!isTitle), stunned ? 'ATURDIDO'
          : blocked ? 'IMPACTO' : protectedNow ? 'PROTEGIDO' : fighter.swing ? 'GOLPE' : '');
        if (!isTitle) {
          for (let pip = 0; pip < 3; pip++) {
            meters.fillStyle(pip < fighter.pips ? color : 0x33445a).fillRoundedRect(105 + side * 540 + pip * 18, 70, 14, 5, 2);
          }
          if (stunned) {
            const fraction = (fighter.blockedUntil - match.liveTick) / ticks(RULES.stun);
            meters.fillStyle(GOLD).fillRect(104 + side * 540, 113, 52 * fraction, 3);
          }
          if (open) {
            const barX = side === 0 ? 48 : 618;
            meters.fillStyle(0x33445a).fillRect(barX, 214, 134, 3);
            meters.fillStyle(goalTime <= RULES.hz ? GOLD : color)
              .fillRect(barX, 214, 134 * goalTime / ticks(RULES.open), 3);
          }
        }

        drawFighter(g, fighter, match.liveTick, alpha, this.visualTime);
        view.markers[side].setVisible(!isTitle).setPosition(
          Phaser.Math.Linear(fighter.oldX, fighter.x, alpha) + shakeX,
          Phaser.Math.Linear(fighter.oldY, fighter.y, alpha) - 67 + shakeY
        );
      }

      const puck = match.puck;
      const x = Phaser.Math.Linear(puck.oldX, puck.x, alpha);
      const y = Phaser.Math.Linear(puck.oldY, puck.y, alpha);
      if (puck.powerUntil > match.liveTick) {
        const fade = (puck.powerUntil - match.liveTick) / ticks(FEEL.trail);
        const speed = Math.hypot(puck.vx, puck.vy) || 1;
        const sx = -puck.vy / speed * 6;
        const sy = puck.vx / speed * 6;
        const tailX = x - puck.vx * 0.10;
        const tailY = y - puck.vy * 0.10;
        g.fillStyle(0xa2d1f2, fade * 0.38).fillTriangle(x + sx, y + sy, x - sx, y - sy, tailX, tailY);
        g.lineStyle(2, WHITE, fade * 0.72).lineBetween(x, y, tailX, tailY);
      }
      for (const flash of this.flashes) drawImpact(g, flash);
      g.fillStyle(INK).fillCircle(x, y, RADIUS + 2);
      g.fillStyle(0x7796b3).fillCircle(x, y, RADIUS);
      g.fillStyle(WHITE).fillEllipse(x, y - 2, RADIUS * 1.76, RADIUS * 1.46);
      g.fillStyle(0xc1d4e8).fillEllipse(x + 1, y - 2, RADIUS, RADIUS * 0.7);
      if (match.phase === 'faceoff') {
        const angle = radians(RULES.serveAngle);
        const dx = Math.cos(angle) * match.serveDirection;
        const dy = Math.sin(angle);
        const tipX = x + dx * 49;
        const tipY = y + dy * 49;
        const baseX = tipX - dx * 10;
        const baseY = tipY - dy * 10;
        g.lineStyle(3, WHITE).lineBetween(x + dx * 20, y + dy * 20, tipX, tipY);
        g.fillStyle(WHITE).fillTriangle(tipX, tipY, baseX - dy * 6, baseY + dx * 6, baseX + dy * 6, baseY - dx * 6);
      }

      this.renderOverlay(view);
    }

    /** @param {ReturnType<HockeyScene['createView']>} view */
    renderGuide(view) {
      const match = this.match;
      const title = match.phase === 'title';
      const joining = title && !this.suspended;
      const useArcadeLabels = view.touch || view.arcadeStart;
      const leftOpen = match.gateOpen(0);
      const rightOpen = match.gateOpen(1);
      let message = '';
      let color = '#f7faff';
      if (joining) {
        message = 'Primero a ' + RULES.goalsToWin + ' goles · ' + RULES.regulation + ' segundos';
      } else if (match.phase === 'live' && !this.suspended && !this.resumeFor) {
        if (leftOpen && rightOpen) {
          message = 'AMBOS ARCOS ABIERTOS · Remata el disco al arco rival';
        } else if (leftOpen || rightOpen) {
          message = leftOpen ? 'J2 · Remata hacia el arco izquierdo' : 'J1 · Remata hacia el arco derecho';
          color = leftOpen ? '#ff9658' : '#56dfff';
        } else {
          message = 'ARCOS CERRADOS · Acércate al rival y pégale de frente';
        }
      }
      showText(view.guide.setY(joining ? 163 : 146).setColor(color), message);
      for (let side = 0; side < 2; side++) {
        const { move, jump, strike } = useArcadeLabels ? ARCADE_CONTROLS : KEYBOARD_CONTROLS[side];
        showText(view.controls[side].setVisible(!title),
          'J' + (side + 1) + '   ' + move + ' mover  ·  ' + jump + ' saltar  ·  ' + strike + ' pega');
        view.titleStations[side].setVisible(joining);
        showText(view.titleControls[side].setVisible(joining),
          'Mover: ' + move + '\nSaltar: ' + jump + '\nPegar: ' + (view.touch ? 'toca ' : '') + strike);
        view.joinLabels[side].setVisible(joining);
        showText(view.joinLabels[side], match.ready[side] ? 'LISTO' : startLabel(side, useArcadeLabels));
      }
      showText(view.joinHint.setVisible(joining), match.ready[0] ? 'Falta J2 · ' + startLabel(1, useArcadeLabels)
        : match.ready[1] ? 'Falta J1 · ' + startLabel(0, useArcadeLabels)
        : 'Dos jugadores · Pulsen ambos START');
    }

    /** @param {ReturnType<HockeyScene['createView']>} view */
    renderOverlay(view) {
      const match = this.match;
      view.panel.clear();
      let headline = '';
      let detail = '';
      let y = 294;
      let titleSize = 42;
      let color = '#f7faff';
      let accent = 0x829dbb;

      if (match.phase === 'title') {
        headline = 'LORCA HOCKEY';
        detail = 'Golpea al rival para abrir su arco por ' + RULES.open + ' s y remata.';
        titleSize = 58;
        y = 60;
      } else if (match.phase === 'faceoff') {
        headline = String(Math.ceil((match.faceoffDuration - match.phaseAge) / RULES.hz));
        detail = match.overtime ? 'Gol de oro · espera el saque' : 'Espera el saque';
      } else if (match.phase === 'goal') {
        headline = '¡GOL J' + (match.scorer + 1) + '!';
        color = match.scorer === 0 ? '#56dfff' : '#ff9658';
        accent = TEAM[match.scorer];
      } else if (match.phase === 'repair') {
        headline = 'NUEVO SAQUE';
      } else if (match.phase === 'result') {
        headline = match.winner === -1 ? 'EMPATE' : 'GANA J' + (match.winner + 1);
        color = match.winner === -1 ? '#f7faff' : match.winner === 0 ? '#56dfff' : '#ff9658';
        accent = match.winner === -1 ? 0xb0c4dd : TEAM[match.winner];
        detail = match.phaseAge < ticks(RULES.resultLock)
          ? match.score.join('  –  ')
          : view.touch || view.arcadeStart ? 'Revancha: START J1 y START J2'
            : 'Revancha: J1 (' + KEYBOARD_START[0] + ') · J2 (' + KEYBOARD_START[1] + ')';
        y = 326;
      }
      if (this.suspended || this.resumeFor > 0) {
        headline = this.suspended ? 'PARTIDA EN ESPERA' : 'REANUDANDO';
        detail = this.suspended ? 'Vuelve a la pestaña para continuar' : '';
        titleSize = 34;
        y = 294;
        color = '#f7faff';
      }

      if (match.phase !== 'title' && !this.suspended && !this.resumeFor) {
        const entry = 1 - clamp(match.phaseAge / ticks(0.16), 0, 1);
        y += entry * entry * 8;
      }
      view.headline.setVisible(Boolean(headline)).setY(y).setColor(color).setFontSize(titleSize);
      view.detail.setVisible(Boolean(detail)).setY(y + (titleSize > 50 ? 48 : 36));
      showText(view.headline, headline);
      showText(view.detail, detail);
      if (headline) {
        const title = titleSize > 50;
        const width = title ? 676 : 410;
        drawPlate(view.panel, 400 - width / 2, y - 35, width, title ? 107 : detail ? 92 : 70, accent);
        if (title) {
          view.panel.lineStyle(3, TEAM[0]).lineBetween(77, y + 27, 386, y + 27);
          view.panel.lineStyle(3, TEAM[1]).lineBetween(414, y + 27, 723, y + 27);
        }
      }
      if (match.phase === 'title' && !this.suspended) {
        for (let side = 0; side < 2; side++) {
          const x = 60 + 352 * side;
          drawPlate(view.panel, x, 220, 328, 216, TEAM[side]);
          view.panel.lineStyle(1, TEAM[side], 0.4).lineBetween(x + 28, 270, x + 300, 270);
          view.panel.fillStyle(TEAM[side], match.ready[side] ? 0.25 : 0.12).fillRoundedRect(x + 27, 384, 274, 43, 5);
        }
      }
    }
  }

  new Phaser.Game({
    type: Phaser.AUTO, parent: 'game-root', width: RULES.width, height: RULES.height,
    backgroundColor: '#101725',
    scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
    // The fixed-step loop already caps catch-up. Phaser smoothing shortens slow frames.
    fps: { smoothStep: false },
    audio: { noAudio: true },
    scene: HockeyScene
  });
})();

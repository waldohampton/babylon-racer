/**
 * Drift scoring.
 *
 * The numbers follow what shipped games converged on rather than anything
 * invented here: speed times angle to a little over the first power, a slip
 * window with a floor and a ceiling, points that build into a chain and bank
 * when you straighten up, and a multiplier that climbs the longer you hold it.
 *
 * Reference points from the wild: 45 deg at 20 m/s (72 km/h) is 200 points a
 * second before the multiplier; the slip window is roughly 12 to 75 deg with a
 * speed floor near 29 km/h; the multiplier climbs by 0.5 every 1.5 s held; a
 * chain banks after about 0.6 s of grip. Reckless Racing 2 kept the points when
 * the player crashed rather than zeroing them, because losing the lot scared
 * new players off, so banked points here are never taken away, only the live
 * chain is at risk.
 */

const DEG = 180 / Math.PI;

export const DRIFT = {
  minSpeed: 8, // m/s, 29 km/h: no points for crawling
  minSlip: 12, // deg, below this it is just cornering
  maxSlip: 75, // deg, above this it is a spin, not a drift
  hold: 0.6, // s of grip before a live chain banks
  multStep: 1.5, // s of continuous sliding per multiplier step
  multGain: 0.5,
  multMax: 10,
  refAngle: 45, // deg, the angle that pays the base rate
  rate: 10, // points per second per m/s at refAngle
  anglePower: 1.2, // angle counts a little harder than linearly
  donutTurns: 1.25, // turns in one direction before scoring pauses
  donutSpeed: 18, // m/s, the guard only applies below this: a fast sweeping
  //                 drift can turn a lot without being a donut
} as const;

export interface ScoreReadout {
  total: number;
  chain: number;
  mult: number;
  pending: number;
  slipDeg: number;
  drifting: boolean;
  lastBank: number;
}

export interface ScoreInput {
  speed: number;
  forwardSpeed: number;
  slip: number; // rad, signed
  yaw: number;
}

export class DriftScore {
  total = 0;
  chain = 0;
  mult = 1;
  slipDeg = 0;
  drifting = false;
  lastBank = 0;

  private live = 0; // s of continuous sliding in this chain
  private rest = 0; // s since the last scoring frame
  private yawAcc = 0; // signed rotation within this chain
  private paused = false; // donut guard tripped
  private lastYaw = 0;

  reset() {
    this.total = 0;
    this.chain = 0;
    this.mult = 1;
    this.slipDeg = 0;
    this.drifting = false;
    this.lastBank = 0;
    this.live = 0;
    this.rest = 0;
    this.yawAcc = 0;
    this.paused = false;
  }

  step(dt: number, s: ScoreInput) {
    const slipDeg = Math.abs(s.slip) * DEG;
    this.slipDeg = slipDeg;

    // net rotation of the body this frame, for the donut guard
    let dyaw = s.yaw - this.lastYaw;
    while (dyaw > Math.PI) dyaw -= Math.PI * 2;
    while (dyaw < -Math.PI) dyaw += Math.PI * 2;
    this.lastYaw = s.yaw;

    const eligible =
      s.speed >= DRIFT.minSpeed &&
      s.forwardSpeed > 0.5 &&
      slipDeg >= DRIFT.minSlip &&
      slipDeg <= DRIFT.maxSlip;

    this.drifting = eligible;

    if (!eligible) {
      this.rest += dt;
      if (this.chain > 0 && this.rest > DRIFT.hold) this.bank();
      return;
    }

    this.rest = 0;
    this.live += dt;
    this.mult = Math.min(DRIFT.multMax, 1 + DRIFT.multGain * Math.floor(this.live / DRIFT.multStep));

    // Donut guard: circling slowly in one direction stops paying after a turn
    // and a quarter, and pays again the moment the direction changes. Above
    // donutSpeed it is off, because a long fast drift turns a lot without being
    // a donut. Measured: donuts die to the speed floor inside 10 s anyway, so
    // this is the backstop, not the main defence.
    if (s.speed < DRIFT.donutSpeed) {
      if (dyaw * this.yawAcc < 0) {
        this.yawAcc = 0;
        this.paused = false;
      }
      this.yawAcc += dyaw;
      if (Math.abs(this.yawAcc) > DRIFT.donutTurns * Math.PI * 2) this.paused = true;
    } else {
      this.yawAcc = 0;
      this.paused = false;
    }

    if (!this.paused) {
      const rate = s.speed * Math.pow(slipDeg / DRIFT.refAngle, DRIFT.anglePower) * DRIFT.rate;
      this.chain += rate * dt;
    }
  }

  private bank() {
    const banked = Math.floor(this.chain * this.mult);
    this.total += banked;
    this.lastBank = banked;
    this.chain = 0;
    this.mult = 1;
    this.live = 0;
    this.rest = 0;
    this.yawAcc = 0;
    this.paused = false;
  }

  readout(): ScoreReadout {
    return {
      total: Math.round(this.total),
      chain: Math.round(this.chain),
      mult: +this.mult.toFixed(1),
      pending: Math.round(this.chain * this.mult),
      slipDeg: Math.round(this.slipDeg),
      drifting: this.drifting,
      lastBank: this.lastBank,
    };
  }
}

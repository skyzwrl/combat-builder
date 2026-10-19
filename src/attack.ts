import { framesToSeconds } from "./frames";
import { Knockback, NO_KNOCKBACK } from "./knockback";
import { HitboxShape } from "./shapes";

export interface FrameRange {
	readonly from: number;
	readonly to: number;
}

export interface HitboxData extends FrameRange {
	readonly shape: HitboxShape;
	readonly damage: number;
	readonly hitstun: number;
	readonly knockback: Knockback;
}

export type ArmorWindow =
	| { readonly kind: "armor"; readonly from: number; readonly to: number; readonly hits: number }
	| { readonly kind: "superArmor"; readonly from: number; readonly to: number };

export type CancelCondition = "contact" | "always";

export interface CancelRule extends FrameRange {
	readonly targets: ReadonlyArray<string>;
	readonly on: CancelCondition;
}

export interface AttackData {
	readonly name: string;
	readonly startup: number;
	readonly recovery: number;
	readonly totalFrames: number;
	readonly duration: number;
	readonly firstActiveFrame: number;
	readonly lastActiveFrame: number;
	readonly activeWindows: ReadonlyArray<FrameRange>;
	/** indexed by frame - 1 */
	readonly activeMask: ReadonlyArray<boolean>;
	readonly hitboxes: ReadonlyArray<HitboxData>;
	readonly damage: number;
	readonly chip: number;
	readonly hitstun: number;
	readonly blockstun: number;
	readonly hitStop: number;
	readonly pushback: number;
	readonly knockback: Knockback;
	readonly maxHitsPerTarget: number;
	readonly rehitInterval: number;
	readonly guardBreak: boolean;
	readonly guardBreakStun: number;
	readonly unblockable: boolean;
	readonly parryRecoil: number;
	readonly armor: ReadonlyArray<ArmorWindow>;
	readonly cancel: CancelRule;
}

export interface HitboxOptions {
	readonly from?: number;
	readonly to?: number;
	readonly damage?: number;
	readonly hitstun?: number;
	readonly knockback?: Knockback;
}

interface Segment {
	readonly kind: "active" | "gap";
	readonly frames: number;
}

function assertWhole(attack: string, label: string, value: number, minimum = 0) {
	if (value % 1 !== 0 || value < minimum) {
		throw `${attack}: ${label} must be a whole number >= ${minimum}, got ${value}`;
	}
}

function assertAmount(attack: string, label: string, value: number) {
	if (!(value >= 0) || value === math.huge) {
		throw `${attack}: ${label} must be zero or positive, got ${value}`;
	}
}

export class AttackBuilder {
	private startupFrames = 0;
	private recoveryFrames = 0;
	private readonly segments = new Array<Segment>();
	private readonly hitboxDefs = new Array<{ shape: HitboxShape; options: HitboxOptions }>();
	private baseDamage = 0;
	private chipDamage = 0;
	private hitstunFrames = 0;
	private blockstunFrames = 0;
	private hitStopFrames = 0;
	private pushbackSpeed = 0;
	private baseKnockback = NO_KNOCKBACK;
	private maxHits = 1;
	private rehitFrames = 1;
	private breaksGuard = false;
	private guardBreakFrames = 0;
	private ignoresBlock = false;
	private parryRecoilFrames = 20;
	private readonly armorWindows = new Array<ArmorWindow>();
	private readonly cancelTargets = new Array<string>();
	private cancelRange?: FrameRange;
	private cancelCondition: CancelCondition = "contact";

	public constructor(private readonly name: string) {}

	/** frames before the first active frame */
	public startup(frames: number): this {
		this.startupFrames = frames;
		return this;
	}

	public active(frames: number): this {
		this.segments.push({ kind: "active", frames });
		return this;
	}

	/** inactive frames between two active windows, e.g. active(2).gap(5).active(3) */
	public gap(frames: number): this {
		this.segments.push({ kind: "gap", frames });
		return this;
	}

	public recovery(frames: number): this {
		this.recoveryFrames = frames;
		return this;
	}

	/** without from/to the hitbox is live on every active frame; earlier hitboxes win ties */
	public hitbox(shape: HitboxShape, options: HitboxOptions = {}): this {
		this.hitboxDefs.push({ shape, options });
		return this;
	}

	public damage(amount: number): this {
		this.baseDamage = amount;
		return this;
	}

	public chip(amount: number): this {
		this.chipDamage = amount;
		return this;
	}

	public hitstun(frames: number): this {
		this.hitstunFrames = frames;
		return this;
	}

	public blockstun(frames: number): this {
		this.blockstunFrames = frames;
		return this;
	}

	public hitStop(frames: number): this {
		this.hitStopFrames = frames;
		return this;
	}

	public pushback(speed: number): this {
		this.pushbackSpeed = speed;
		return this;
	}

	public knockback(knockback: Knockback): this {
		this.baseKnockback = knockback;
		return this;
	}

	public multiHit(maxHits: number, rehitInterval: number): this {
		this.maxHits = maxHits;
		this.rehitFrames = rehitInterval;
		return this;
	}

	public guardBreak(stunFrames = 40): this {
		this.breaksGuard = true;
		this.guardBreakFrames = stunFrames;
		return this;
	}

	public unblockable(): this {
		this.ignoresBlock = true;
		return this;
	}

	public parryRecoil(frames: number): this {
		this.parryRecoilFrames = frames;
		return this;
	}

	public armor(from: number, to: number, hits = 1): this {
		this.armorWindows.push({ kind: "armor", from, to, hits });
		return this;
	}

	public superArmor(from: number, to: number): this {
		this.armorWindows.push({ kind: "superArmor", from, to });
		return this;
	}

	public cancelInto(...targets: string[]): this {
		for (const target of targets) {
			this.cancelTargets.push(target);
		}
		return this;
	}

	public cancelWindow(from: number, to: number): this {
		this.cancelRange = { from, to };
		return this;
	}

	public cancelOn(condition: CancelCondition): this {
		this.cancelCondition = condition;
		return this;
	}

	public build(): AttackData {
		const name = this.name;
		if (name === "") {
			throw "attack name can't be empty";
		}

		assertWhole(name, "startup", this.startupFrames);
		assertWhole(name, "recovery", this.recoveryFrames);
		if (this.segments.isEmpty()) {
			throw `${name}: needs at least one active() window`;
		}
		if (this.segments[0].kind === "gap" || this.segments[this.segments.size() - 1].kind === "gap") {
			throw `${name}: gap() only goes between two active() windows`;
		}

		const activeWindows = new Array<FrameRange>();
		let cursor = this.startupFrames;
		for (const segment of this.segments) {
			assertWhole(name, segment.kind, segment.frames, 1);
			if (segment.kind === "active") {
				activeWindows.push(table.freeze({ from: cursor + 1, to: cursor + segment.frames }));
			}
			cursor += segment.frames;
		}

		const firstActiveFrame = this.startupFrames + 1;
		const lastActiveFrame = cursor;
		const totalFrames = cursor + this.recoveryFrames;

		const activeMask = new Array<boolean>(totalFrames, false);
		for (const window of activeWindows) {
			for (let frame = window.from; frame <= window.to; frame++) {
				activeMask[frame - 1] = true;
			}
		}

		assertAmount(name, "damage", this.baseDamage);
		assertAmount(name, "chip", this.chipDamage);
		assertWhole(name, "hitstun", this.hitstunFrames);
		assertWhole(name, "blockstun", this.blockstunFrames);
		assertWhole(name, "hit stop", this.hitStopFrames);
		assertWhole(name, "guard break stun", this.guardBreakFrames);
		assertWhole(name, "parry recoil", this.parryRecoilFrames);
		assertWhole(name, "max hits", this.maxHits, 1);
		assertWhole(name, "rehit interval", this.rehitFrames, 1);

		if (this.hitboxDefs.isEmpty()) {
			throw `${name}: needs at least one hitbox`;
		}

		const hitboxes = this.hitboxDefs.map(({ shape, options }) => {
			const from = options.from ?? firstActiveFrame;
			const to = options.to ?? lastActiveFrame;
			if (from % 1 !== 0 || to % 1 !== 0 || from > to || from < firstActiveFrame || to > lastActiveFrame) {
				throw `${name}: hitbox frames ${from}-${to} fall outside the active frames ${firstActiveFrame}-${lastActiveFrame}`;
			}
			let live = false;
			for (let frame = from; frame <= to && !live; frame++) {
				live = activeMask[frame - 1];
			}
			if (!live) {
				throw `${name}: hitbox frames ${from}-${to} only cover gap frames`;
			}

			const damage = options.damage ?? this.baseDamage;
			const hitstun = options.hitstun ?? this.hitstunFrames;
			assertAmount(name, "hitbox damage", damage);
			assertWhole(name, "hitbox hitstun", hitstun);

			return table.freeze({
				shape,
				from,
				to,
				damage,
				hitstun,
				knockback: options.knockback ?? this.baseKnockback,
			});
		});

		for (const window of this.armorWindows) {
			if (window.from % 1 !== 0 || window.to % 1 !== 0 || window.from < 1 || window.to > totalFrames) {
				throw `${name}: armor frames ${window.from}-${window.to} fall outside the attack (1-${totalFrames})`;
			}
			if (window.from > window.to) {
				throw `${name}: armor window starts after it ends (${window.from}-${window.to})`;
			}
			if (window.kind === "armor") {
				assertWhole(name, "armor hits", window.hits, 1);
			}
		}

		const cancelRange = this.cancelRange ?? { from: firstActiveFrame, to: totalFrames };
		if (
			cancelRange.from % 1 !== 0 ||
			cancelRange.to % 1 !== 0 ||
			cancelRange.from < 1 ||
			cancelRange.to > totalFrames ||
			cancelRange.from > cancelRange.to
		) {
			throw `${name}: cancel window ${cancelRange.from}-${cancelRange.to} doesn't fit in the attack (1-${totalFrames})`;
		}

		return table.freeze({
			name,
			startup: this.startupFrames,
			recovery: this.recoveryFrames,
			totalFrames,
			duration: framesToSeconds(totalFrames),
			firstActiveFrame,
			lastActiveFrame,
			activeWindows: table.freeze(activeWindows),
			activeMask: table.freeze(activeMask),
			hitboxes: table.freeze(hitboxes),
			damage: this.baseDamage,
			chip: this.chipDamage,
			hitstun: this.hitstunFrames,
			blockstun: this.blockstunFrames,
			hitStop: this.hitStopFrames,
			pushback: this.pushbackSpeed,
			knockback: this.baseKnockback,
			maxHitsPerTarget: this.maxHits,
			rehitInterval: this.rehitFrames,
			guardBreak: this.breaksGuard,
			guardBreakStun: this.guardBreakFrames,
			unblockable: this.ignoresBlock,
			parryRecoil: this.parryRecoilFrames,
			armor: table.freeze(this.armorWindows.map((window) => table.freeze(table.clone(window)))),
			cancel: table.freeze({
				targets: table.freeze(table.clone(this.cancelTargets)),
				from: cancelRange.from,
				to: cancelRange.to,
				on: this.cancelCondition,
			}),
		});
	}
}

export function attack(name: string): AttackBuilder {
	return new AttackBuilder(name);
}

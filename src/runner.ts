import { AttackData, HitboxData } from "./attack";
import { FRAME_TIME } from "./frames";
import { knockbackVector } from "./knockback";
import { HitboxShape, WorldBox, WorldShape, WorldSphere } from "./shapes";

export type Phase = "idle" | "startup" | "active" | "recovery";

export interface HitDetector<T> {
	/** push every target overlapping the shape into results, the shape object is reused after this returns */
	query(shape: WorldShape, results: T[]): void;
}

export interface HitEvent<T> {
	readonly attack: AttackData;
	readonly hitbox: HitboxData;
	readonly target: T;
	readonly frame: number;
	readonly hitNumber: number;
	readonly damage: number;
	readonly hitstun: number;
	readonly knockback: Vector3;
	readonly launched: boolean;
	readonly origin: CFrame;
}

export type ArmorState = { readonly kind: "armor"; readonly hitsRemaining: number } | { readonly kind: "superArmor" };

export interface RunnerOptions<T> {
	readonly detector: HitDetector<T>;
	readonly getOrigin: () => CFrame;
	readonly canHit?: (target: T) => boolean;
	readonly onHit?: (hit: HitEvent<T>) => void;
	readonly onEnd?: (attack: AttackData, cancelled: boolean) => void;
}

interface HitRecord {
	count: number;
	lastFrame: number;
}

type Writable<T> = { -readonly [K in keyof T]: T[K] };

// summed dts drift by a few ulps, without this two 1/120 steps can land just short of a frame
const EPSILON = 1e-9;

const SUPER_ARMOR: ArmorState = table.freeze({ kind: "superArmor" });

export class AttackRunner<T> {
	private attack?: AttackData;
	private frame = 0;
	private accumulator = 0;
	private hitStopLeft = 0;
	private contact = false;
	private stepping = false;
	private previousOrigin = CFrame.identity;
	private readonly registry = new Map<T, HitRecord>();
	private readonly armorUsed = new Map<number, number>();
	private readonly results = new Array<T>();
	private readonly worldBox: Writable<WorldBox> = { kind: "box", cframe: CFrame.identity, size: Vector3.one };
	private readonly worldSphere: Writable<WorldSphere> = { kind: "sphere", position: Vector3.zero, radius: 1 };

	public constructor(private readonly options: RunnerOptions<T>) {}

	public play(attack: AttackData): void {
		const previous = this.attack;
		this.attack = attack;
		this.frame = 0;
		this.hitStopLeft = 0;
		this.contact = false;
		this.registry.clear();
		this.armorUsed.clear();

		// started from inside step (a cancel on hit), the attack begins on the frame boundary that
		// triggered it, so the leftover time carries over and frame rate doesn't shift its timing
		if (!this.stepping) {
			this.accumulator = 0;
			this.previousOrigin = this.options.getOrigin();
		}

		if (previous) {
			this.options.onEnd?.(previous, true);
		}
	}

	public tryCancelInto(followUp: AttackData): boolean {
		if (!this.canCancelInto(followUp.name)) {
			return false;
		}
		this.play(followUp);
		return true;
	}

	public stop(): void {
		const attack = this.attack;
		if (attack) {
			this.finish(attack, true);
		}
	}

	public step(dt: number): void {
		if (!this.attack) {
			return;
		}

		const origin = this.options.getOrigin();
		let boundary = FRAME_TIME - this.accumulator;
		this.accumulator += dt;
		this.stepping = true;

		while (this.attack && this.accumulator + EPSILON >= FRAME_TIME) {
			this.accumulator -= FRAME_TIME;
			// place each frame where the root was when that frame ticked instead of where it is at the
			// end of the step, otherwise a long step stacks several frames on the same spot
			const alpha = math.clamp(boundary / dt, 0, 1);
			this.advance(alpha >= 1 ? origin : this.previousOrigin.Lerp(origin, alpha));
			boundary += FRAME_TIME;
		}

		this.stepping = false;
		this.previousOrigin = origin;
	}

	public isPlaying(): boolean {
		return this.attack !== undefined;
	}

	public getAttack(): AttackData | undefined {
		return this.attack;
	}

	public getFrame(): number {
		return this.frame;
	}

	public getPhase(): Phase {
		const attack = this.attack;
		if (!attack) {
			return "idle";
		} else if (this.frame < attack.firstActiveFrame) {
			return "startup";
		} else if (this.frame <= attack.lastActiveFrame) {
			return "active";
		}
		return "recovery";
	}

	public isInHitStop(): boolean {
		return this.hitStopLeft > 0;
	}

	public hasContact(): boolean {
		return this.contact;
	}

	public canCancelInto(name: string): boolean {
		const attack = this.attack;
		if (!attack) {
			return false;
		}
		const rule = attack.cancel;
		return (
			this.frame >= rule.from &&
			this.frame <= rule.to &&
			(rule.on === "always" || this.contact) &&
			rule.targets.includes(name)
		);
	}

	public getArmor(): ArmorState | undefined {
		const attack = this.attack;
		if (!attack) {
			return undefined;
		}

		let armor: ArmorState | undefined;
		for (let index = 0; index < attack.armor.size(); index++) {
			const window = attack.armor[index];
			if (this.frame < window.from || this.frame > window.to) {
				continue;
			}
			if (window.kind === "superArmor") {
				return SUPER_ARMOR;
			}
			const hitsRemaining = window.hits - (this.armorUsed.get(index) ?? 0);
			if (armor === undefined && hitsRemaining > 0) {
				armor = { kind: "armor", hitsRemaining };
			}
		}
		return armor;
	}

	public absorbHit(): void {
		const attack = this.attack;
		if (!attack) {
			return;
		}
		for (let index = 0; index < attack.armor.size(); index++) {
			const window = attack.armor[index];
			if (this.frame < window.from || this.frame > window.to) {
				continue;
			}
			if (window.kind === "superArmor") {
				return;
			}
			const used = this.armorUsed.get(index) ?? 0;
			if (used < window.hits) {
				this.armorUsed.set(index, used + 1);
				return;
			}
		}
	}

	private advance(origin: CFrame): void {
		const attack = this.attack!;

		if (this.hitStopLeft > 0) {
			this.hitStopLeft -= 1;
		} else {
			this.frame += 1;
			if (attack.activeMask[this.frame - 1]) {
				this.runHitboxes(attack, origin);
				if (this.attack !== attack) {
					return;
				}
			}
		}

		// a hit on the last frame still gets its full hit stop before the attack lets go
		if (this.hitStopLeft === 0 && this.frame >= attack.totalFrames) {
			this.finish(attack, false);
		}
	}

	private runHitboxes(attack: AttackData, origin: CFrame): void {
		const frame = this.frame;
		const results = this.results;
		let landed = false;

		for (const hitbox of attack.hitboxes) {
			if (frame < hitbox.from || frame > hitbox.to) {
				continue;
			}

			results.clear();
			this.options.detector.query(this.toWorld(hitbox.shape, origin), results);

			for (const target of results) {
				const hitNumber = this.register(target, attack, frame);
				if (hitNumber === 0) {
					continue;
				}

				landed = true;
				this.contact = true;

				const onHit = this.options.onHit;
				if (onHit) {
					onHit({
						attack,
						hitbox,
						target,
						frame,
						hitNumber,
						damage: hitbox.damage,
						hitstun: hitbox.hitstun,
						knockback: knockbackVector(hitbox.knockback, origin),
						launched: hitbox.knockback.airborne,
						origin,
					});
					if (this.attack !== attack) {
						return;
					}
				}
			}
		}

		if (landed) {
			this.hitStopLeft = attack.hitStop;
		}
	}

	private register(target: T, attack: AttackData, frame: number): number {
		const canHit = this.options.canHit;
		if (canHit && !canHit(target)) {
			return 0;
		}

		const record = this.registry.get(target);
		if (record === undefined) {
			this.registry.set(target, { count: 1, lastFrame: frame });
			return 1;
		}
		if (record.count >= attack.maxHitsPerTarget || frame - record.lastFrame < attack.rehitInterval) {
			return 0;
		}
		record.count += 1;
		record.lastFrame = frame;
		return record.count;
	}

	private toWorld(shape: HitboxShape, origin: CFrame): WorldShape {
		if (shape.kind === "box") {
			const world = this.worldBox;
			world.cframe = origin.mul(shape.cframe);
			world.size = shape.size;
			return world;
		}
		const world = this.worldSphere;
		world.position = origin.PointToWorldSpace(shape.position);
		world.radius = shape.radius;
		return world;
	}

	private finish(attack: AttackData, cancelled: boolean): void {
		this.attack = undefined;
		this.frame = 0;
		this.hitStopLeft = 0;
		this.options.onEnd?.(attack, cancelled);
	}
}

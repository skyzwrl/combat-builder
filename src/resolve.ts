import { facingOf } from "./knockback";
import { ArmorState, HitEvent } from "./runner";

export type HitOutcome = "hit" | "blocked" | "parried" | "guardBreak" | "armored";

export interface DefenderState {
	readonly cframe: CFrame;
	readonly blocking: boolean;
	readonly parrying: boolean;
	readonly armor?: ArmorState;
}

export interface HitResolution {
	readonly outcome: HitOutcome;
	readonly damage: number;
	/** frames of hitstun, blockstun or guard break stun for the defender */
	readonly stun: number;
	readonly knockback: Vector3;
	/** frames the attacker is locked for after being parried */
	readonly attackerStun: number;
}

function isFacing(defender: CFrame, attackerPosition: Vector3): boolean {
	const offset = attackerPosition.sub(defender.Position);
	const flat = new Vector3(offset.X, 0, offset.Z);
	// overlapping roots count as in front so a block doesn't fail on rounding
	return flat.Magnitude < 1e-6 || facingOf(defender).Dot(flat) > 0;
}

export function resolveHit(hit: HitEvent<unknown>, defender: DefenderState): HitResolution {
	const attack = hit.attack;
	const inFront = isFacing(defender.cframe, hit.origin.Position);

	// parries are about timing, unblockable only rules out holding block
	if (defender.parrying && inFront) {
		return { outcome: "parried", damage: 0, stun: 0, knockback: Vector3.zero, attackerStun: attack.parryRecoil };
	}

	if (defender.blocking && inFront && !attack.unblockable) {
		const pushback = facingOf(hit.origin).mul(attack.pushback);
		return {
			outcome: attack.guardBreak ? "guardBreak" : "blocked",
			damage: attack.chip,
			stun: attack.guardBreak ? attack.guardBreakStun : attack.blockstun,
			knockback: pushback,
			attackerStun: 0,
		};
	}

	const armor = defender.armor;
	if (armor && (armor.kind === "superArmor" || armor.hitsRemaining > 0)) {
		return { outcome: "armored", damage: hit.damage, stun: 0, knockback: Vector3.zero, attackerStun: 0 };
	}

	return { outcome: "hit", damage: hit.damage, stun: hit.hitstun, knockback: hit.knockback, attackerStun: 0 };
}

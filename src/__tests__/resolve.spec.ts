/// <reference types="@rbxts/testez/globals" />

import { attack, AttackData, box, DefenderState, HitEvent, knockbackVector, push, resolveHit } from "..";

const attackerRoot = new CFrame(0, 0, 0);
const defenderSpot = new Vector3(0, 0, -4);
const facingAttacker = CFrame.lookAt(defenderSpot, attackerRoot.Position);
const facingAway = CFrame.lookAt(defenderSpot, defenderSpot.add(new Vector3(0, 0, -1)));

function hitWith(data: AttackData): HitEvent<string> {
	const hitbox = data.hitboxes[0];
	return {
		attack: data,
		hitbox,
		target: "defender",
		frame: data.firstActiveFrame,
		hitNumber: 1,
		damage: hitbox.damage,
		hitstun: hitbox.hitstun,
		knockback: knockbackVector(hitbox.knockback, attackerRoot),
		launched: hitbox.knockback.airborne,
		origin: attackerRoot,
	};
}

function defender(overrides: Partial<DefenderState> = {}): DefenderState {
	return { cframe: facingAttacker, blocking: false, parrying: false, ...overrides };
}

const strike = attack("Strike")
	.startup(5)
	.active(3)
	.recovery(12)
	.hitbox(box(3, 3, 4).offset(0, 0, -3))
	.damage(10)
	.chip(2)
	.hitstun(16)
	.blockstun(9)
	.pushback(8)
	.knockback(push(20))
	.build();

export = () => {
	describe("resolveHit", () => {
		it("lands a clean hit on an idle defender", () => {
			const result = resolveHit(hitWith(strike), defender());

			expect(result.outcome).to.equal("hit");
			expect(result.damage).to.equal(10);
			expect(result.stun).to.equal(16);
			expect(result.knockback.Z).to.be.near(-20, 1e-4);
			expect(result.attackerStun).to.equal(0);
		});

		it("turns into chip damage and pushback against a block", () => {
			const result = resolveHit(hitWith(strike), defender({ blocking: true }));

			expect(result.outcome).to.equal("blocked");
			expect(result.damage).to.equal(2);
			expect(result.stun).to.equal(9);
			expect(result.knockback.Z).to.be.near(-8, 1e-4);
			expect(result.knockback.Y).to.equal(0);
		});

		it("doesn't let a defender block from behind", () => {
			expect(resolveHit(hitWith(strike), defender({ blocking: true, cframe: facingAway })).outcome).to.equal(
				"hit",
			);
		});

		it("goes through blocks when unblockable", () => {
			const grab = attack("Grab")
				.startup(8)
				.active(2)
				.recovery(20)
				.hitbox(box(2, 4, 2))
				.damage(15)
				.unblockable()
				.build();

			expect(resolveHit(hitWith(grab), defender({ blocking: true })).outcome).to.equal("hit");
		});

		it("breaks guard with a guard break attack", () => {
			const breaker = attack("Breaker")
				.startup(14)
				.active(3)
				.recovery(18)
				.hitbox(box(4, 4, 4))
				.damage(18)
				.chip(4)
				.guardBreak(50)
				.build();
			const result = resolveHit(hitWith(breaker), defender({ blocking: true }));

			expect(result.outcome).to.equal("guardBreak");
			expect(result.damage).to.equal(4);
			expect(result.stun).to.equal(50);
		});

		it("parries from the front, even against unblockables", () => {
			const grab = attack("Grab")
				.startup(8)
				.active(2)
				.recovery(20)
				.hitbox(box(2, 4, 2))
				.unblockable()
				.build();
			const parried = resolveHit(hitWith(grab), defender({ parrying: true }));

			expect(parried.outcome).to.equal("parried");
			expect(parried.damage).to.equal(0);
			expect(parried.attackerStun).to.equal(20);

			const slow = attack("Slow")
				.startup(20)
				.active(2)
				.hitbox(box(2, 2, 2))
				.parryRecoil(35)
				.build();
			expect(resolveHit(hitWith(slow), defender({ parrying: true })).attackerStun).to.equal(35);
		});

		it("can't parry what it can't see", () => {
			expect(resolveHit(hitWith(strike), defender({ parrying: true, cframe: facingAway })).outcome).to.equal(
				"hit",
			);
		});

		it("lets armor soak the hit but not the damage", () => {
			const armored = resolveHit(hitWith(strike), defender({ armor: { kind: "armor", hitsRemaining: 1 } }));
			expect(armored.outcome).to.equal("armored");
			expect(armored.damage).to.equal(10);
			expect(armored.stun).to.equal(0);
			expect(armored.knockback).to.equal(Vector3.zero);

			const spent = resolveHit(hitWith(strike), defender({ armor: { kind: "armor", hitsRemaining: 0 } }));
			expect(spent.outcome).to.equal("hit");

			const superArmor = resolveHit(hitWith(strike), defender({ armor: { kind: "superArmor" } }));
			expect(superArmor.outcome).to.equal("armored");
		});

		it("prefers a block over armor", () => {
			const result = resolveHit(hitWith(strike), defender({ blocking: true, armor: { kind: "superArmor" } }));
			expect(result.outcome).to.equal("blocked");
		});
	});
};

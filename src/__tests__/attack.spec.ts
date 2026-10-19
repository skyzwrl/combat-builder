/// <reference types="@rbxts/testez/globals" />

import { attack, box, launch, push, sphere } from "..";

function activeFrames(mask: ReadonlyArray<boolean>): string {
	const frames = new Array<number>();
	mask.forEach((live, index) => {
		if (live) {
			frames.push(index + 1);
		}
	});
	return frames.join(",");
}

export = () => {
	describe("frame data", () => {
		it("lays frames out as startup, active, recovery", () => {
			const uppercut = attack("Uppercut")
				.startup(6)
				.active(4)
				.recovery(14)
				.hitbox(box(5, 6, 4))
				.build();

			expect(uppercut.firstActiveFrame).to.equal(7);
			expect(uppercut.lastActiveFrame).to.equal(10);
			expect(uppercut.totalFrames).to.equal(24);
			expect(uppercut.duration).to.be.near(0.4, 1e-9);
			expect(activeFrames(uppercut.activeMask)).to.equal("7,8,9,10");
		});

		it("puts gaps between active windows", () => {
			const flurry = attack("Flurry").startup(4).active(2).gap(5).active(3).recovery(8).hitbox(sphere(3)).build();

			expect(flurry.activeWindows.size()).to.equal(2);
			expect(flurry.activeWindows[0].from).to.equal(5);
			expect(flurry.activeWindows[1].from).to.equal(12);
			expect(flurry.lastActiveFrame).to.equal(14);
			expect(flurry.totalFrames).to.equal(22);
			expect(activeFrames(flurry.activeMask)).to.equal("5,6,12,13,14");
		});

		it("defaults hitbox frames to the active span and resolves per hitbox overrides", () => {
			const tipper = launch(40, 60);
			const swing = attack("Swing")
				.startup(5)
				.active(6)
				.recovery(10)
				.damage(8)
				.hitstun(12)
				.knockback(push(15))
				.hitbox(sphere(1.5).offset(0, 0, -6), { from: 6, to: 7, damage: 14, knockback: tipper })
				.hitbox(box(4, 4, 6).offset(0, 0, -3))
				.build();

			const sweet = swing.hitboxes[0];
			const sour = swing.hitboxes[1];
			expect(sweet.from).to.equal(6);
			expect(sweet.to).to.equal(7);
			expect(sweet.damage).to.equal(14);
			expect(sweet.hitstun).to.equal(12);
			expect(sweet.knockback).to.equal(tipper);
			expect(sour.from).to.equal(6);
			expect(sour.to).to.equal(11);
			expect(sour.damage).to.equal(8);
			expect(sour.knockback.speed).to.equal(15);
		});

		it("keeps cancel windows from the first active frame to the end by default", () => {
			const jab = attack("Jab")
				.startup(3)
				.active(2)
				.recovery(9)
				.hitbox(box(2, 2, 3))
				.cancelInto("Dash")
				.build();

			expect(jab.cancel.from).to.equal(4);
			expect(jab.cancel.to).to.equal(14);
			expect(jab.cancel.on).to.equal("contact");
			expect(jab.cancel.targets.join(",")).to.equal("Dash");
		});
	});

	describe("built data", () => {
		it("is frozen", () => {
			const jab = attack("Jab")
				.startup(3)
				.active(2)
				.recovery(5)
				.hitbox(box(2, 2, 3))
				.build();

			expect(() => {
				(jab as { damage: number }).damage = 100;
			}).to.throw();
			expect(() => {
				(jab.hitboxes as unknown as defined[]).push(jab.hitboxes[0]);
			}).to.throw();
		});

		it("doesn't change when the builder is reused", () => {
			const builder = attack("Slam")
				.startup(10)
				.active(3)
				.recovery(20)
				.hitbox(box(8, 4, 8))
				.armor(1, 10);
			const first = builder.build();
			builder.superArmor(11, 13).cancelInto("Roll");
			const second = builder.build();

			expect(first.armor.size()).to.equal(1);
			expect(first.cancel.targets.size()).to.equal(0);
			expect(second.armor.size()).to.equal(2);
			expect(second.cancel.targets.size()).to.equal(1);
		});
	});

	describe("validation", () => {
		const base = () =>
			attack("Bad")
				.startup(2)
				.active(2)
				.recovery(2)
				.hitbox(box(1, 1, 1));

		it("needs a name, an active window and a hitbox", () => {
			expect(() =>
				attack("")
					.active(1)
					.hitbox(box(1, 1, 1))
					.build(),
			).to.throw("attack name can't be empty");
			expect(() =>
				attack("Bad")
					.hitbox(box(1, 1, 1))
					.build(),
			).to.throw("Bad: needs at least one active()");
			expect(() => attack("Bad").active(2).build()).to.throw("Bad: needs at least one hitbox");
		});

		it("only allows gaps between active windows", () => {
			expect(() =>
				attack("Bad")
					.gap(2)
					.active(2)
					.hitbox(box(1, 1, 1))
					.build(),
			).to.throw("gap() only goes between");
			expect(() =>
				attack("Bad")
					.active(2)
					.gap(2)
					.hitbox(box(1, 1, 1))
					.build(),
			).to.throw("gap() only goes between");
		});

		it("rejects partial and negative frame counts", () => {
			expect(() => base().startup(1.5).build()).to.throw("Bad: startup must be a whole number >= 0, got 1.5");
			expect(() => base().recovery(-1).build()).to.throw("recovery must be a whole number");
			expect(() => base().active(0).build()).to.throw("active must be a whole number >= 1");
			expect(() => base().hitStop(0.5).build()).to.throw("hit stop must be a whole number");
			expect(() => base().multiHit(0, 4).build()).to.throw("max hits must be a whole number >= 1");
			expect(() => base().multiHit(3, 0).build()).to.throw("rehit interval must be a whole number >= 1");
		});

		it("rejects negative or non finite amounts", () => {
			expect(() => base().damage(-1).build()).to.throw("Bad: damage must be zero or positive, got -1");
			expect(() =>
				base()
					.damage(0 / 0)
					.build(),
			).to.throw("damage must be zero or positive");
			expect(() => base().chip(math.huge).build()).to.throw("chip must be zero or positive");
		});

		it("keeps hitboxes inside the active frames", () => {
			expect(() =>
				attack("Bad")
					.startup(6)
					.active(4)
					.hitbox(box(1, 1, 1), { from: 3, to: 12 })
					.build(),
			).to.throw("Bad: hitbox frames 3-12 fall outside the active frames 7-10");

			expect(() =>
				attack("Bad")
					.active(2)
					.gap(4)
					.active(2)
					.hitbox(box(1, 1, 1), { from: 3, to: 6 })
					.build(),
			).to.throw("hitbox frames 3-6 only cover gap frames");
		});

		it("keeps armor and cancel windows inside the attack", () => {
			expect(() => base().armor(0, 3).build()).to.throw("armor frames 0-3 fall outside the attack (1-6)");
			expect(() => base().superArmor(5, 2).build()).to.throw("armor window starts after it ends");
			expect(() => base().armor(1, 3, 0).build()).to.throw("armor hits must be a whole number >= 1");
			expect(() => base().cancelWindow(2, 40).build()).to.throw("cancel window 2-40 doesn't fit");
		});

		it("rejects empty shapes straight away", () => {
			expect(() => box(0, 2, 2)).to.throw("box width must be a positive number");
			expect(() => sphere(-1)).to.throw("sphere radius must be a positive number");
			expect(() => box(1, 1, math.huge)).to.throw("box depth must be a positive number");
		});
	});
};

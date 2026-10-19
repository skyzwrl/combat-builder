/// <reference types="@rbxts/testez/globals" />

import { attack, AttackRunner, box, FRAME_TIME, HitEvent, sphere } from "..";
import { Dummy, dummy, FakeWorld } from "./world";

interface HarnessOptions {
	dummies?: Dummy[];
	canHit?: (target: Dummy) => boolean;
	onHit?: (hit: HitEvent<Dummy>, runner: AttackRunner<Dummy>) => void;
}

function harness(options: HarnessOptions = {}) {
	const world = new FakeWorld(options.dummies);
	const hits = new Array<HitEvent<Dummy>>();
	const ended = new Array<string>();
	let origin = new CFrame();

	const runner: AttackRunner<Dummy> = new AttackRunner<Dummy>({
		detector: world,
		getOrigin: () => origin,
		canHit: options.canHit,
		onHit: (hit) => {
			hits.push(hit);
			options.onHit?.(hit, runner);
		},
		onEnd: (finished, cancelled) => {
			ended.push(`${finished.name}:${cancelled ? "cancelled" : "finished"}`);
		},
	});

	const setOrigin = (value: CFrame) => {
		origin = value;
	};

	return { runner, world, hits, ended, setOrigin };
}

function stepFrames(runner: AttackRunner<Dummy>, frames: number) {
	for (let index = 0; index < frames; index++) {
		runner.step(FRAME_TIME);
	}
}

function describeArmor(runner: AttackRunner<Dummy>): string {
	const armor = runner.getArmor();
	if (armor === undefined) {
		return "none";
	}
	return armor.kind === "superArmor" ? "super" : `${armor.hitsRemaining}`;
}

const inFront = () => dummy("front", new Vector3(0, 0, -3));

const jab = attack("Jab")
	.startup(3)
	.active(2)
	.recovery(5)
	.hitbox(box(2, 2, 3).offset(0, 0, -2.5))
	.damage(5)
	.hitstun(10)
	.build();

export = () => {
	describe("timing", () => {
		it("plays one frame per 60th of a second", () => {
			const { runner, hits, ended } = harness({ dummies: [inFront()] });
			runner.play(jab);
			expect(runner.getPhase()).to.equal("startup");

			stepFrames(runner, 3);
			expect(runner.getFrame()).to.equal(3);
			expect(runner.getPhase()).to.equal("startup");
			expect(hits.size()).to.equal(0);

			stepFrames(runner, 1);
			expect(runner.getPhase()).to.equal("active");
			expect(hits.size()).to.equal(1);
			expect(hits[0].frame).to.equal(4);

			stepFrames(runner, 2);
			expect(runner.getPhase()).to.equal("recovery");

			stepFrames(runner, 3);
			expect(runner.isPlaying()).to.equal(true);
			stepFrames(runner, 1);
			expect(runner.isPlaying()).to.equal(false);
			expect(runner.getPhase()).to.equal("idle");
			expect(runner.getFrame()).to.equal(0);
			expect(ended.join(",")).to.equal("Jab:finished");
		});

		it("lands on the same frames however dt is sliced", () => {
			const flurry = attack("Flurry")
				.startup(5)
				.active(30)
				.recovery(10)
				.hitbox(sphere(4))
				.multiHit(5, 6)
				.hitStop(3)
				.build();

			const hitFrames = (dts: number[]) => {
				const { runner, hits } = harness({ dummies: [dummy("target", new Vector3(0, 0, -2))] });
				runner.play(flurry);
				let index = 0;
				while (runner.isPlaying()) {
					runner.step(dts[index % dts.size()]);
					index++;
				}
				return hits.map((hit) => hit.frame).join(",");
			};

			const expected = hitFrames([FRAME_TIME]);
			expect(expected).to.equal("6,12,18,24,30");
			expect(hitFrames([1 / 30])).to.equal(expected);
			expect(hitFrames([1 / 144])).to.equal(expected);
			expect(hitFrames([0.013])).to.equal(expected);
			expect(hitFrames([0.05, 0.002, 0.031])).to.equal(expected);
			expect(hitFrames([0.25])).to.equal(expected);
		});

		it("counts frames from elapsed time, not from step count", () => {
			const long = attack("Long").startup(100).active(1).hitbox(sphere(1)).build();

			const frameAfter = (dt: number, seconds: number) => {
				const { runner } = harness();
				runner.play(long);
				let elapsed = 0;
				while (elapsed + dt <= seconds + 1e-9) {
					runner.step(dt);
					elapsed += dt;
				}
				return runner.getFrame();
			};

			expect(frameAfter(FRAME_TIME, 0.5)).to.equal(30);
			expect(frameAfter(1 / 30, 0.5)).to.equal(30);
			expect(frameAfter(1 / 120, 0.5)).to.equal(30);
			expect(frameAfter(0.1, 0.5)).to.equal(30);
			expect(frameAfter(0.5, 0.5)).to.equal(30);
		});

		it("interpolates the root across a long step", () => {
			const spin = attack("Spin").active(10).hitbox(sphere(1)).build();

			// the attacker slides one stud per frame along +X past a target at x = 5
			const firstHit = (framesPerStep: number) => {
				const { runner, hits, setOrigin } = harness({ dummies: [dummy("target", new Vector3(5, 0, 0), 1.5)] });
				runner.play(spin);
				let x = 0;
				while (runner.isPlaying()) {
					x += framesPerStep;
					setOrigin(new CFrame(x, 0, 0));
					runner.step(framesPerStep * FRAME_TIME);
				}
				return hits.size() > 0 ? hits[0].frame : -1;
			};

			expect(firstHit(1)).to.equal(3);
			expect(firstHit(5)).to.equal(3);
			expect(firstHit(10)).to.equal(3);
		});
	});

	describe("hits", () => {
		it("hits a target once per attack by default", () => {
			const { runner, hits } = harness({ dummies: [inFront()] });
			runner.play(
				attack("Poke")
					.startup(1)
					.active(8)
					.recovery(1)
					.hitbox(box(2, 2, 3).offset(0, 0, -2.5))
					.build(),
			);
			stepFrames(runner, 10);

			expect(hits.size()).to.equal(1);
		});

		it("re-hits on the rehit interval until the max", () => {
			const { runner, hits } = harness({ dummies: [dummy("target", new Vector3(0, 0, -2))] });
			runner.play(attack("Drill").startup(2).active(12).recovery(4).hitbox(sphere(3)).multiHit(3, 4).build());
			stepFrames(runner, 18);

			expect(hits.map((hit) => hit.frame).join(",")).to.equal("3,7,11");
			expect(hits.map((hit) => hit.hitNumber).join(",")).to.equal("1,2,3");
		});

		it("lets the first listed hitbox win when two overlap the same target", () => {
			const swing = attack("Swing")
				.startup(1)
				.active(3)
				.recovery(1)
				.damage(8)
				.hitbox(sphere(1).offset(0, 0, -5), { damage: 20 })
				.hitbox(box(4, 4, 8).offset(0, 0, -4))
				.build();
			const { runner, hits } = harness({
				dummies: [dummy("tip", new Vector3(0, 0, -5)), dummy("close", new Vector3(0, 0, -1.5))],
			});
			runner.play(swing);
			stepFrames(runner, 5);

			expect(hits.size()).to.equal(2);
			expect(hits[0].target.name).to.equal("tip");
			expect(hits[0].damage).to.equal(20);
			expect(hits[0].hitbox).to.equal(swing.hitboxes[0]);
			expect(hits[1].target.name).to.equal("close");
			expect(hits[1].damage).to.equal(8);
		});

		it("only queries hitboxes on their own frames", () => {
			const combo = attack("Combo")
				.startup(2)
				.active(4)
				.recovery(2)
				.hitbox(sphere(1), { from: 3, to: 4 })
				.hitbox(box(1, 1, 1), { from: 5, to: 6 })
				.build();
			const { runner, world } = harness();
			runner.play(combo);
			stepFrames(runner, 8);

			expect(world.queries.map((shape) => shape.kind).join(",")).to.equal("sphere,sphere,box,box");
		});

		it("skips gap frames between active windows", () => {
			const { runner, world } = harness();
			runner.play(attack("Double").active(2).gap(3).active(2).hitbox(sphere(2)).build());
			stepFrames(runner, 7);

			expect(world.queries.size()).to.equal(4);
		});

		it("skips targets rejected by canHit", () => {
			const { runner, hits } = harness({
				dummies: [dummy("ally", new Vector3(0, 0, -3)), dummy("enemy", new Vector3(0.5, 0, -3))],
				canHit: (target) => target.name !== "ally",
			});
			runner.play(jab);
			stepFrames(runner, 10);

			expect(hits.size()).to.equal(1);
			expect(hits[0].target.name).to.equal("enemy");
		});

		it("places local hitboxes relative to the root", () => {
			const { runner, world, setOrigin } = harness();
			setOrigin(CFrame.lookAt(new Vector3(10, 0, 0), new Vector3(20, 0, 0)));
			runner.play(
				attack("Probe")
					.active(1)
					.hitbox(box(2, 2, 2).offset(0, 0, -3).rotate(0, 90, 0))
					.hitbox(sphere(1).offset(0, 2, -1))
					.build(),
			);
			stepFrames(runner, 1);

			const boxQuery = world.queries[0];
			const sphereQuery = world.queries[1];
			assert(boxQuery.kind === "box" && sphereQuery.kind === "sphere");

			expect(boxQuery.cframe.Position.sub(new Vector3(13, 0, 0)).Magnitude).to.be.near(0, 1e-4);
			expect(boxQuery.cframe.LookVector.sub(new Vector3(0, 0, -1)).Magnitude).to.be.near(0, 1e-4);
			expect(sphereQuery.position.sub(new Vector3(11, 2, 0)).Magnitude).to.be.near(0, 1e-4);
		});
	});

	describe("hit stop", () => {
		it("freezes the attack and extends it by the stop length", () => {
			const heavy = attack("Heavy")
				.startup(3)
				.active(2)
				.recovery(5)
				.hitbox(box(2, 2, 3).offset(0, 0, -2.5))
				.hitStop(4)
				.build();
			const { runner } = harness({ dummies: [inFront()] });
			runner.play(heavy);

			stepFrames(runner, 4);
			expect(runner.getFrame()).to.equal(4);
			expect(runner.isInHitStop()).to.equal(true);

			stepFrames(runner, 3);
			expect(runner.getFrame()).to.equal(4);
			expect(runner.isInHitStop()).to.equal(true);

			stepFrames(runner, 1);
			expect(runner.isInHitStop()).to.equal(false);
			stepFrames(runner, 1);
			expect(runner.getFrame()).to.equal(5);

			stepFrames(runner, 4);
			expect(runner.isPlaying()).to.equal(true);
			stepFrames(runner, 1);
			expect(runner.isPlaying()).to.equal(false);
		});

		it("holds the last frame until a stop that starts on it runs out", () => {
			const { runner } = harness({ dummies: [inFront()] });
			runner.play(
				attack("Finisher")
					.startup(2)
					.active(1)
					.hitbox(box(2, 2, 3).offset(0, 0, -2.5))
					.hitStop(5)
					.build(),
			);

			stepFrames(runner, 3);
			expect(runner.isPlaying()).to.equal(true);
			stepFrames(runner, 4);
			expect(runner.isPlaying()).to.equal(true);
			stepFrames(runner, 1);
			expect(runner.isPlaying()).to.equal(false);
		});

		it("doesn't count frozen frames toward the rehit interval", () => {
			const { runner, hits } = harness({ dummies: [dummy("target", new Vector3(0, 0, -2))] });
			runner.play(
				attack("Pummel").startup(1).active(10).recovery(1).hitbox(sphere(3)).multiHit(2, 3).hitStop(5).build(),
			);
			stepFrames(runner, 30);

			expect(hits.map((hit) => hit.frame).join(",")).to.equal("2,5");
		});
	});

	describe("ending and cancelling", () => {
		it("reports attacks that get replaced or stopped as cancelled", () => {
			const heavy = attack("Heavy").startup(10).active(2).hitbox(sphere(2)).build();
			const { runner, ended } = harness();

			runner.play(jab);
			stepFrames(runner, 2);
			runner.play(heavy);
			runner.stop();
			runner.stop();

			expect(ended.join(",")).to.equal("Jab:cancelled,Heavy:cancelled");
			expect(runner.isPlaying()).to.equal(false);
		});

		it("opens contact cancels only after something was hit", () => {
			const cancellable = attack("Jab")
				.startup(3)
				.active(2)
				.recovery(9)
				.hitbox(box(2, 2, 3).offset(0, 0, -2.5))
				.cancelInto("Dash", "Uppercut")
				.build();

			const whiff = harness();
			whiff.runner.play(cancellable);
			stepFrames(whiff.runner, 5);
			expect(whiff.runner.canCancelInto("Dash")).to.equal(false);

			const { runner } = harness({ dummies: [inFront()] });
			runner.play(cancellable);
			stepFrames(runner, 3);
			expect(runner.canCancelInto("Dash")).to.equal(false);
			stepFrames(runner, 1);
			expect(runner.canCancelInto("Dash")).to.equal(true);
			expect(runner.canCancelInto("Uppercut")).to.equal(true);
			expect(runner.canCancelInto("Jump")).to.equal(false);
			stepFrames(runner, 9);
			expect(runner.getFrame()).to.equal(13);
			expect(runner.canCancelInto("Dash")).to.equal(true);
		});

		it("can open a cancel window that doesn't need contact", () => {
			const { runner } = harness();
			runner.play(
				attack("Feint")
					.startup(3)
					.active(2)
					.recovery(6)
					.hitbox(sphere(1))
					.cancelInto("Dash")
					.cancelOn("always")
					.cancelWindow(2, 6)
					.build(),
			);

			stepFrames(runner, 1);
			expect(runner.canCancelInto("Dash")).to.equal(false);
			stepFrames(runner, 1);
			expect(runner.canCancelInto("Dash")).to.equal(true);
			stepFrames(runner, 5);
			expect(runner.canCancelInto("Dash")).to.equal(false);
		});

		it("starts a cancel on the frame that triggered it at any frame rate", () => {
			const opener = attack("Jab")
				.startup(3)
				.active(2)
				.recovery(9)
				.hitbox(box(2, 2, 3).offset(0, 0, -2.5))
				.cancelInto("Uppercut")
				.build();
			const uppercut = attack("Uppercut")
				.startup(4)
				.active(2)
				.recovery(6)
				.hitbox(sphere(1).offset(0, 0, -20))
				.build();

			const afterCancel = (framesPerStep: number) => {
				const { runner, ended } = harness({
					dummies: [inFront()],
					onHit: (_, owner) => owner.tryCancelInto(uppercut),
				});
				runner.play(opener);
				for (let index = 0; index < 6 / framesPerStep; index++) {
					runner.step(framesPerStep * FRAME_TIME);
				}
				return `${runner.getAttack()?.name}:${runner.getFrame()}:${ended.join(",")}`;
			};

			expect(afterCancel(1)).to.equal("Uppercut:2:Jab:cancelled");
			expect(afterCancel(3)).to.equal("Uppercut:2:Jab:cancelled");
			expect(afterCancel(6)).to.equal("Uppercut:2:Jab:cancelled");
		});

		it("refuses cancels that aren't allowed", () => {
			const { runner } = harness();
			runner.play(jab);
			stepFrames(runner, 4);

			expect(runner.tryCancelInto(jab)).to.equal(false);
			expect(runner.getAttack()).to.equal(jab);
			expect(runner.getFrame()).to.equal(4);
		});

		it("stops hitting with the old attack once a hit cancels it", () => {
			const uppercut = attack("Uppercut")
				.startup(4)
				.active(2)
				.recovery(6)
				.hitbox(sphere(1).offset(0, 0, -20))
				.build();
			const opener = attack("Jab")
				.startup(3)
				.active(2)
				.recovery(9)
				.hitbox(box(4, 2, 3).offset(0, 0, -2.5))
				.cancelInto("Uppercut")
				.build();
			const { runner, hits } = harness({
				dummies: [inFront(), dummy("beside", new Vector3(1, 0, -3))],
				onHit: (_, owner) => owner.tryCancelInto(uppercut),
			});
			runner.play(opener);
			stepFrames(runner, 6);

			expect(hits.size()).to.equal(1);
			expect(runner.getAttack()).to.equal(uppercut);
		});
	});

	describe("armor", () => {
		it("absorbs a limited number of hits, then lets super armor take over", () => {
			const slam = attack("Slam")
				.startup(12)
				.active(3)
				.recovery(20)
				.hitbox(box(8, 4, 8))
				.armor(1, 8, 2)
				.superArmor(9, 15)
				.build();
			const { runner } = harness();
			runner.play(slam);
			expect(describeArmor(runner)).to.equal("none");

			stepFrames(runner, 3);
			expect(describeArmor(runner)).to.equal("2");
			runner.absorbHit();
			expect(describeArmor(runner)).to.equal("1");
			runner.absorbHit();
			expect(describeArmor(runner)).to.equal("none");

			stepFrames(runner, 7);
			expect(describeArmor(runner)).to.equal("super");
			runner.absorbHit();
			expect(describeArmor(runner)).to.equal("super");

			stepFrames(runner, 6);
			expect(describeArmor(runner)).to.equal("none");
		});
	});
};

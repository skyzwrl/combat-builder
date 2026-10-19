/// <reference types="@rbxts/testez/globals" />

import { knockbackVector, launch, NO_KNOCKBACK, push } from "..";

function near(actual: Vector3, expected: Vector3): boolean {
	return actual.sub(expected).Magnitude < 1e-4;
}

const facingX = CFrame.lookAt(new Vector3(), new Vector3(1, 0, 0));

export = () => {
	describe("knockback", () => {
		it("pushes along the attacker's facing", () => {
			expect(near(knockbackVector(push(10), new CFrame()), new Vector3(0, 0, -10))).to.equal(true);
			expect(near(knockbackVector(push(10), facingX), new Vector3(10, 0, 0))).to.equal(true);
		});

		it("launches at an angle above the horizontal", () => {
			const half = 10 * math.sqrt(0.5);
			expect(near(knockbackVector(launch(10, 45), facingX), new Vector3(half, half, 0))).to.equal(true);
			expect(near(knockbackVector(launch(10, 90), facingX), new Vector3(0, 10, 0))).to.equal(true);
		});

		it("turns positive yaw toward the attacker's right", () => {
			expect(near(knockbackVector(push(10, 90), facingX), new Vector3(0, 0, 10))).to.equal(true);
			expect(near(knockbackVector(push(10, 90), new CFrame()), new Vector3(10, 0, 0))).to.equal(true);
			expect(near(knockbackVector(push(10, -90), new CFrame()), new Vector3(-10, 0, 0))).to.equal(true);
		});

		it("ignores the attacker's pitch", () => {
			const lookingDown = facingX.mul(CFrame.Angles(math.rad(-30), 0, 0));
			expect(near(knockbackVector(push(10), lookingDown), new Vector3(10, 0, 0))).to.equal(true);
		});

		it("pulls toward the attacker with a negative speed", () => {
			expect(near(knockbackVector(push(-6), facingX), new Vector3(-6, 0, 0))).to.equal(true);
		});

		it("marks launches as airborne", () => {
			expect(launch(10, 45).airborne).to.equal(true);
			expect(push(10).airborne).to.equal(false);
			expect(knockbackVector(NO_KNOCKBACK, facingX)).to.equal(Vector3.zero);
		});
	});
};

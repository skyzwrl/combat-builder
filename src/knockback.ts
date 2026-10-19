export interface Knockback {
	readonly speed: number;
	/** degrees above the horizontal */
	readonly angle: number;
	/** degrees clockwise from the attacker's facing, seen from above */
	readonly yaw: number;
	readonly airborne: boolean;
}

export const NO_KNOCKBACK: Knockback = table.freeze({ speed: 0, angle: 0, yaw: 0, airborne: false });

export function push(speed: number, yaw = 0): Knockback {
	return table.freeze({ speed, angle: 0, yaw, airborne: false });
}

export function launch(speed: number, angle: number, yaw = 0): Knockback {
	return table.freeze({ speed, angle, yaw, airborne: true });
}

export function facingOf(origin: CFrame): Vector3 {
	const look = origin.LookVector;
	const flat = new Vector3(look.X, 0, look.Z);
	return flat.Magnitude > 1e-6 ? flat.Unit : new Vector3(0, 0, -1);
}

export function knockbackVector(knockback: Knockback, origin: CFrame): Vector3 {
	if (knockback.speed === 0) {
		return Vector3.zero;
	}

	const forward = facingOf(origin);
	const right = new Vector3(-forward.Z, 0, forward.X);
	const yaw = math.rad(knockback.yaw);
	const elevation = math.rad(knockback.angle);

	const horizontal = forward.mul(math.cos(yaw)).add(right.mul(math.sin(yaw)));
	return horizontal
		.mul(math.cos(elevation) * knockback.speed)
		.add(new Vector3(0, math.sin(elevation) * knockback.speed, 0));
}

// local shapes are relative to the attacker's root, -Z is forward like every Roblox CFrame
export class BoxShape {
	public readonly kind = "box";
	public readonly cframe: CFrame;

	public constructor(
		public readonly size: Vector3,
		public readonly position = Vector3.zero,
		public readonly rotation = Vector3.zero,
	) {
		this.cframe = new CFrame(position.X, position.Y, position.Z).mul(
			CFrame.Angles(math.rad(rotation.X), math.rad(rotation.Y), math.rad(rotation.Z)),
		);
	}

	public offset(x: number, y: number, z: number): BoxShape {
		return new BoxShape(this.size, new Vector3(x, y, z), this.rotation);
	}

	public rotate(x: number, y: number, z: number): BoxShape {
		return new BoxShape(this.size, this.position, new Vector3(x, y, z));
	}
}

export class SphereShape {
	public readonly kind = "sphere";

	public constructor(
		public readonly radius: number,
		public readonly position = Vector3.zero,
	) {}

	public offset(x: number, y: number, z: number): SphereShape {
		return new SphereShape(this.radius, new Vector3(x, y, z));
	}
}

export type HitboxShape = BoxShape | SphereShape;

export interface WorldBox {
	readonly kind: "box";
	readonly cframe: CFrame;
	readonly size: Vector3;
}

export interface WorldSphere {
	readonly kind: "sphere";
	readonly position: Vector3;
	readonly radius: number;
}

export type WorldShape = WorldBox | WorldSphere;

function assertPositive(value: number, label: string) {
	if (!(value > 0) || value === math.huge) {
		throw `${label} must be a positive number, got ${value}`;
	}
}

export function box(x: number, y: number, z: number): BoxShape {
	assertPositive(x, "box width");
	assertPositive(y, "box height");
	assertPositive(z, "box depth");
	return new BoxShape(new Vector3(x, y, z));
}

export function sphere(radius: number): SphereShape {
	assertPositive(radius, "sphere radius");
	return new SphereShape(radius);
}

import { HitDetector, WorldShape } from "..";

export interface Dummy {
	readonly name: string;
	position: Vector3;
	readonly radius: number;
}

export function dummy(name: string, position: Vector3, radius = 1): Dummy {
	return { name, position, radius };
}

function overlaps(shape: WorldShape, target: Dummy): boolean {
	if (shape.kind === "sphere") {
		return shape.position.sub(target.position).Magnitude <= shape.radius + target.radius;
	}
	const relative = shape.cframe.PointToObjectSpace(target.position);
	const half = shape.size.div(2);
	const closest = new Vector3(
		math.clamp(relative.X, -half.X, half.X),
		math.clamp(relative.Y, -half.Y, half.Y),
		math.clamp(relative.Z, -half.Z, half.Z),
	);
	return relative.sub(closest).Magnitude <= target.radius;
}

export class FakeWorld implements HitDetector<Dummy> {
	public readonly queries = new Array<WorldShape>();

	public constructor(public readonly dummies: Dummy[] = []) {}

	public query(shape: WorldShape, results: Dummy[]): void {
		this.queries.push(table.clone(shape));
		for (const target of this.dummies) {
			if (overlaps(shape, target)) {
				results.push(target);
			}
		}
	}
}

import { Workspace } from "@rbxts/services";
import { HitDetector } from "./runner";
import { WorldShape } from "./shapes";

function characterOf(part: BasePart): Model | undefined {
	let current = part.Parent;
	while (current) {
		if (current.IsA("Model") && current.FindFirstChildOfClass("Humanoid")) {
			return current;
		}
		current = current.Parent;
	}
	return undefined;
}

export class OverlapHitDetector implements HitDetector<Model> {
	private readonly params = new OverlapParams();
	private readonly found = new Set<Model>();

	public constructor(
		ignore: Instance[] = [],
		private readonly world: WorldRoot = Workspace,
	) {
		this.params.FilterType = Enum.RaycastFilterType.Exclude;
		this.params.FilterDescendantsInstances = ignore;
	}

	public setIgnored(ignore: Instance[]): void {
		this.params.FilterDescendantsInstances = ignore;
	}

	public query(shape: WorldShape, results: Model[]): void {
		// bounds queries on purpose, much cheaper than GetPartsInPart and melee wants a little generosity
		const parts =
			shape.kind === "box"
				? this.world.GetPartBoundsInBox(shape.cframe, shape.size, this.params)
				: this.world.GetPartBoundsInRadius(shape.position, shape.radius, this.params);

		this.found.clear();
		for (const part of parts) {
			const character = characterOf(part);
			if (character && !this.found.has(character)) {
				this.found.add(character);
				results.push(character);
			}
		}
	}
}

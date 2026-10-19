import { Debris, Players, ReplicatedStorage, RunService } from "@rbxts/services";
import {
	AttackData,
	AttackRunner,
	DefenderState,
	FRAME_TIME,
	HitEvent,
	OverlapHitDetector,
	resolveHit,
} from "@skyzwrl/combat-builder";
import { Flurry, GroundSlam, Jab, Uppercut } from "./attacks";

interface Fighter {
	readonly root: BasePart;
	readonly humanoid: Humanoid;
	readonly runner: AttackRunner<Model>;
	blocking: boolean;
	parryUntil: number;
	stunnedUntil: number;
}

const moves = new Map<string, AttackData>([
	["Jab", Jab],
	["Uppercut", Uppercut],
	["Flurry", Flurry],
	["GroundSlam", GroundSlam],
]);

const fighters = new Map<Model, Fighter>();

function defenderState(fighter: Fighter): DefenderState {
	return {
		cframe: fighter.root.CFrame,
		blocking: fighter.blocking,
		parrying: os.clock() < fighter.parryUntil,
		armor: fighter.runner.getArmor(),
	};
}

// players own their character's physics, so knockback goes through a replicated constraint
// instead of setting velocity from the server
function applyKnockback(root: BasePart, velocity: Vector3) {
	if (velocity.Magnitude < 1e-3) {
		return;
	}
	const attachment = new Instance("Attachment");
	attachment.Parent = root;

	const mover = new Instance("LinearVelocity");
	mover.Attachment0 = attachment;
	mover.MaxForce = math.huge;
	mover.VectorVelocity = velocity;
	mover.Parent = root;

	Debris.AddItem(mover, 0.15);
	Debris.AddItem(attachment, 0.15);
}

function stun(fighter: Fighter, frames: number) {
	fighter.runner.stop();
	fighter.stunnedUntil = math.max(fighter.stunnedUntil, os.clock() + frames * FRAME_TIME);
}

function onHit(attacker: Fighter, hit: HitEvent<Model>) {
	const defender = fighters.get(hit.target);
	if (!defender) {
		return;
	}

	const result = resolveHit(hit, defenderState(defender));
	if (result.outcome === "armored") {
		defender.runner.absorbHit();
	}
	if (result.stun > 0) {
		stun(defender, result.stun);
	}
	if (result.attackerStun > 0) {
		stun(attacker, result.attackerStun);
	}

	defender.humanoid.TakeDamage(result.damage);
	applyKnockback(defender.root, result.knockback);
}

function addFighter(character: Model) {
	const root = character.WaitForChild("HumanoidRootPart") as BasePart;
	const humanoid = character.WaitForChild("Humanoid") as Humanoid;

	const fighter: Fighter = {
		root,
		humanoid,
		runner: new AttackRunner<Model>({
			detector: new OverlapHitDetector([character]),
			getOrigin: () => root.CFrame,
			canHit: (target) => target !== character,
			onHit: (hit) => onHit(fighter, hit),
		}),
		blocking: false,
		parryUntil: 0,
		stunnedUntil: 0,
	};

	fighters.set(character, fighter);
	humanoid.Died.Once(() => {
		fighter.runner.stop();
		fighters.delete(character);
	});
}

function requestAttack(character: Model, name: string) {
	const fighter = fighters.get(character);
	const data = moves.get(name);
	if (!fighter || !data || os.clock() < fighter.stunnedUntil) {
		return;
	}

	if (!fighter.runner.isPlaying()) {
		fighter.runner.play(data);
	} else {
		fighter.runner.tryCancelInto(data);
	}
}

const attackRequest = new Instance("RemoteEvent");
attackRequest.Name = "AttackRequest";
attackRequest.Parent = ReplicatedStorage;

attackRequest.OnServerEvent.Connect((player, name) => {
	const character = player.Character;
	if (character && typeIs(name, "string")) {
		requestAttack(character, name);
	}
});

RunService.Heartbeat.Connect((dt) => {
	for (const [, fighter] of fighters) {
		fighter.runner.step(dt);
	}
});

Players.PlayerAdded.Connect((player) => {
	player.CharacterAdded.Connect(addFighter);
});

export const FPS = 60;
export const FRAME_TIME = 1 / FPS;

export function framesToSeconds(frames: number): number {
	return frames * FRAME_TIME;
}

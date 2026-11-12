/** A sound to play: name inside the game's package, or a full id ("aktion.schubsen") from a shared one. */
export type Cue = { name: string; volume?: number; pan?: number; delayMs?: number };

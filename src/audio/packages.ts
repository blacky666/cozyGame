/**
 * Sound packages under public/audio/<name>/ that the menus load in the background. Kept apart from
 * the minigame registry so the menu chunk does not pull in Phaser; a test checks they match.
 */
export const SOUND_PACKAGES: readonly string[] = ['ui', 'ablauf', 'aktion', 'schneeball', 'kartoffel', 'farbkrieg', 'wackelturm'];

const MOBILE_UA = /Android|iPhone|iPad|iPod|Mobile|Windows Phone/i;

/** Mobile = mobile user agent, or touch-primary on a narrow screen. */
export function isMobile(nav: { maxTouchPoints: number; userAgent: string }, width: number): boolean {
  return MOBILE_UA.test(nav.userAgent) || (nav.maxTouchPoints > 0 && width < 900);
}

export const MOBILE_TEXT = 'cozyGame bitte am PC spielen';

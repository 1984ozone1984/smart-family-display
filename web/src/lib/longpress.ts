import type { Attachment } from 'svelte/attachments';

const HOLD_MS = 550;
/** Mehr Bewegung gilt als Scrollen, nicht als Halten */
const SLOP_PX = 12;

/**
 * Langes Drücken (Finger oder Maus) auf dem Element. Der Klick, der danach beim Loslassen
 * entsteht, wird verschluckt, damit nicht zusätzlich eine Kachel oder ein Termin aufgeht.
 */
export function longpress(fn: () => void): Attachment<HTMLElement> {
	return (el) => {
		let timer: ReturnType<typeof setTimeout> | null = null;
		let start = { x: 0, y: 0 };
		let fired = false;

		const cancel = () => {
			if (timer) clearTimeout(timer);
			timer = null;
		};
		const down = (e: PointerEvent) => {
			if (e.button !== 0) return;
			fired = false;
			start = { x: e.clientX, y: e.clientY };
			cancel();
			timer = setTimeout(() => {
				timer = null;
				fired = true;
				fn();
			}, HOLD_MS);
		};
		const move = (e: PointerEvent) => {
			if (timer && Math.hypot(e.clientX - start.x, e.clientY - start.y) > SLOP_PX) cancel();
		};
		const click = (e: MouseEvent) => {
			if (!fired) return;
			fired = false;
			e.preventDefault();
			e.stopPropagation();
		};
		// Android öffnet bei langem Druck sonst das Kontextmenü bzw. markiert Text
		const menu = (e: Event) => e.preventDefault();

		el.addEventListener('pointerdown', down);
		el.addEventListener('pointermove', move);
		el.addEventListener('pointerup', cancel);
		el.addEventListener('pointercancel', cancel);
		el.addEventListener('pointerleave', cancel);
		el.addEventListener('click', click, true);
		el.addEventListener('contextmenu', menu);
		return () => {
			cancel();
			el.removeEventListener('pointerdown', down);
			el.removeEventListener('pointermove', move);
			el.removeEventListener('pointerup', cancel);
			el.removeEventListener('pointercancel', cancel);
			el.removeEventListener('pointerleave', cancel);
			el.removeEventListener('click', click, true);
			el.removeEventListener('contextmenu', menu);
		};
	};
}

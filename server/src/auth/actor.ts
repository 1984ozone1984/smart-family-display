import type { FastifyRequest } from 'fastify';

/**
 * Ungeschützte Aktionen (Belohnung anfragen/zurückziehen): Am Tablet (LAN) genügt die
 * angetippte Person – das Gerät wird gemeinsam genutzt. Über die öffentliche Adresse muss die
 * angemeldete Person es selbst sein oder ein Elternteil.
 */
export function mayActFor(req: FastifyRequest, personId: number): boolean {
	if (req.via === 'lan') return true;
	return !!req.person && (req.person.id === personId || req.person.role === 'parent');
}

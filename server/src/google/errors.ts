export class GoogleError extends Error {
	status: number;
	reason: string;
	constructor(status: number, reason: string) {
		super(`Google ${status}: ${reason}`);
		this.status = status;
		this.reason = reason;
	}
}

export async function googleError(res: Response): Promise<GoogleError> {
	const body = (await res.json().catch(() => ({}))) as {
		error?: string | { message?: string; errors?: { reason?: string }[] };
	};
	const e = body.error;
	const reason =
		typeof e === 'string' ? e : (e?.errors?.[0]?.reason ?? e?.message ?? res.statusText);
	return new GoogleError(res.status, reason);
}

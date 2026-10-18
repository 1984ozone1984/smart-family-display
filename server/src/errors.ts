/** Fachlicher Fehler mit HTTP-Status; Routen senden `{ error: code }`. */
export class AppError extends Error {
	status: 400 | 403 | 404 | 409 | 422;
	code: string;
	constructor(status: AppError['status'], code: string) {
		super(code);
		this.status = status;
		this.code = code;
	}
}

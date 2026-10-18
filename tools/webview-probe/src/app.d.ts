declare global {
	interface Window {
		fully?: Record<string, unknown>;
		__probeErrors?: string[];
		__probeMounted?: boolean;
	}
}

export {};

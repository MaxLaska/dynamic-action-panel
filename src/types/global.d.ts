// Global type augmentations for custom DOM events

declare global {
	interface DocumentEventMap {
		'buttons-panel-refresh': CustomEvent<unknown>;
		'buttons-panel-search': CustomEvent<{ query?: string }>;
	}

	// dnd-kit sensor listener target, used by the hover-expand nudge
	var __dndSensorTarget: EventTarget | undefined;
}

export {};


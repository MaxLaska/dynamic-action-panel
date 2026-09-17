/**
 * Interface every button action implements.
 * It unifies form rendering, validation, serialization and error handling.
 */
export interface IButtonAction {
    /** Action type string */
    type: string;
    /**
     * Renders the form controls.
     * @param container Container element
     * @param context Render context (shape defined by each action)
     */
    render(container: HTMLElement, context: unknown): void;
    /** Validates the form data */
    validate(): boolean;
    /**
     * True when the user has not entered anything at all in this action row.
     *
     * The plugin distinguishes "not configured yet" from "configured wrongly": an
     * untouched row is dropped on save, so a tool may exist with a name, an
     * icon and a slot but no action (running it then just says so), whereas a
     * half-filled row still blocks the save instead of silently discarding
     * what was typed. Absent implementation falls back to `!validate()`.
     */
    isEmpty?(): boolean;
    /** Serializes the action to its JSON shape */
    toJSON(): unknown;
    /** Shows an error on the inputs of this action (optional) */
    setError?(message: string): void;
    /** Clears the error state (optional) */
    clearError?(): void;
}



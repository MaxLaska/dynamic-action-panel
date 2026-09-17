import { IButtonAction } from '@/actions/IButtonAction';
import { ACTION_TYPES } from '@/actions/registry';

/**
 * Creates action instances from raw data or from a type string.
 * Also exposes the known action types for validation and dropdowns.
 */
export class ButtonActionFactory {
    /**
     * Creates an action instance from raw JSON data.
     * @param raw Raw action object
     */
    static fromRaw(raw: unknown): IButtonAction {
        if (!raw || typeof raw !== 'object' || !('type' in raw)) {
            throw new Error('Invalid raw action: ' + JSON.stringify(raw));
        }
        const type = (raw as { type: string }).type;
        const ActionClass = ACTION_TYPES[type as keyof typeof ACTION_TYPES];
        if (!ActionClass) {
            throw new Error('Unknown action type: ' + type);
        }
        const parameters = (raw as { parameters?: unknown }).parameters;
        // Each action validates and normalizes its own parameters shape.
        return new ActionClass(parameters as never);
    }

    /**
     * Creates an action instance from a type and its parameters.
     * @param type Action type string
     * @param parameters Constructor parameters
     */
    static createAction(type: string, parameters: unknown): IButtonAction {
        const ActionClass = ACTION_TYPES[type as keyof typeof ACTION_TYPES];
        if (!ActionClass) {
            throw new Error('Unknown action type: ' + type);
        }
        // Each action validates and normalizes its own parameters shape.
        return new ActionClass(parameters as never);
    }

    /**
     * Returns every available action type string.
     */
    static getAvailableActionTypes(): string[] {
        return Object.keys(ACTION_TYPES);
    }

    /**
     * Returns whether the given action type is known.
     */
    static isValidActionType(type: string): boolean {
        return type in ACTION_TYPES;
    }
}



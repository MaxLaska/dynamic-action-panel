// buttonFactory.ts
// Factory for default button configurations.
import { ButtonConfig } from '@/types';
import { freshId } from '@/utils/id';

/**
 * Creates a default button configuration.
 * @returns ButtonConfig with default values
 */
export function createDefaultButtonConfig(): ButtonConfig {
    return {
        id: freshId(),
        name: '',
        icon: '',
        actions: [] as ButtonConfig['actions'],
        order: 0,
        executionMode: 'sequential',
        stopOnError: true,
        delayBetweenActions: 100,
    };
}

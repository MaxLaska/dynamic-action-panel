// buttonFactory.ts
// 按钮工厂函数，生成默认按钮配置对象。
import { ButtonConfig } from '@/types';
import { freshId } from '@/utils/id';

/**
 * 创建一个默认的按钮配置对象。
 * @returns ButtonConfig 默认按钮配置
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

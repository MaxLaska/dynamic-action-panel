import { useCallback } from 'react';
import { Notice } from 'obsidian';
import { useActionDispatcher } from './useActionDispatcher';
import { t } from '@/utils/i18n';
import type { ButtonConfig } from '@/types';

/**
 * useButtonActions Hook
 * 
 * 封装按钮动作执行的业务逻辑，提供便捷的按钮点击处理函数。
 * 自动处理按钮的执行模式、错误处理、延迟等配置。
 * 
 * @returns 按钮动作执行函数
 */
export function useButtonActions() {
    const { executeActions } = useActionDispatcher();

    /**
     * 执行按钮的所有动作
     * @param button 按钮配置对象
     */
    const executeButtonActions = useCallback(
        async (button: ButtonConfig) => {
            // A tool may legitimately exist before its action does (name,
            // icon and slot first — see ActionSequence.collectConfiguredActions).
            // Running it then has to SAY so: silence would read as a broken
            // button, and inventing a fallback action would be worse.
            if (!button.actions || button.actions.length === 0) {
                new Notice(t('button_no_action'));
                return;
            }

            await executeActions(
                button.actions,
                button.executionMode || 'sequential',
                button.stopOnError ?? true,
                button.delayBetweenActions ?? 100
            );
        },
        [executeActions]
    );

    return {
        executeButtonActions,
    };
}


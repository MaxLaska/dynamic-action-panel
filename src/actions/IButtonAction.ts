/**
 * 按钮动作接口，所有动作类型需实现该接口。
 * 统一表单渲染、校验、序列化、错误处理等方法。
 */
export interface IButtonAction {
    /** 动作类型字符串 */
    type: string;
    /**
     * 渲染表单控件
     * @param container 容器元素
     * @param context 上下文（具体结构由各动作自行定义）
     */
    render(container: HTMLElement, context: unknown): void;
    /** 校验表单数据有效性 */
    validate(): boolean;
    /**
     * True when the user has not entered anything at all in this action row.
     *
     * OCAP distinguishes "not configured yet" from "configured wrongly": an
     * untouched row is dropped on save, so a tool may exist with a name, an
     * icon and a slot but no action (running it then just says so), whereas a
     * half-filled row still blocks the save instead of silently discarding
     * what was typed. Absent implementation falls back to `!validate()`.
     */
    isEmpty?(): boolean;
    /** 序列化为 JSON 数据 */
    toJSON(): unknown;
    /** 设置错误提示（可选） */
    setError?(message: string): void;
    /** 清除错误提示（可选） */
    clearError?(): void;
}



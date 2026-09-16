// settings.ts
// 用户设置/配置相关类型定义。
import type { ButtonAction } from '@/types/action';
import type { ButtonCondition } from '@/types/conditions';

/**
 * Current settings schema version.
 * Bump together with a new migration step in src/settings/settingsMigrations.ts.
 * Version history:
 * - 0 (implicit): unversioned upstream Buttons Panel settings (no settingsVersion field)
 * - 1: settingsVersion introduced; nested defaults deep-merged; optional
 *      ButtonConfig.conditions added (absent field = always visible).
 *      Phase 3 additionally added optional CategoryConfig.conditions — a
 *      purely additive optional field that requires no data transformation,
 *      so it stays within version 1.
 *      Phase 4 (palette grid) added optional CategoryConfig.layout and
 *      ButtonConfig.slot on the same terms: an absent layout means the
 *      historical flow behavior and an absent slot is only consulted inside a
 *      grid category, so no stored data needs transforming and version 1 data
 *      written today stays loadable by earlier builds.
 */
export const CURRENT_SETTINGS_VERSION = 1;

/**
 * ButtonConfig 按钮配置对象类型。
 * 描述单个按钮的所有属性。
 */
export interface ButtonConfig {
    /** 按钮唯一ID */
    id: string;
    /** 按钮名称 */
    name: string;
    /** 按钮图标（SVG或字符） */
    icon?: string;
    /** 按钮动作序列 */
    actions: ButtonAction[];
    /** 按钮在分类内的排序值 */
    order: number;
    /** 按钮自定义样式（可选） */
    customCss?: string;
    /** 动作执行模式（顺序/并行） */
    executionMode?: 'sequential' | 'parallel';
    /** 某个动作失败时是否停止 */
    stopOnError?: boolean;
    /** 顺序执行时动作间延迟（毫秒） */
    delayBetweenActions?: number;
    /**
     * Optional declarative visibility condition (OCAP Context Engine).
     * Absent/undefined = the button behaves exactly like a static upstream
     * button and is always visible. Conditions are applied against the
     * current OCAPContext snapshot in locked interaction mode only; in
     * sort/edit mode the button stays manageable (visually marked).
     */
    conditions?: ButtonCondition;
    /**
     * Palette grid slot (0..15) of this button inside a `layout: 'grid'`
     * category. Ignored by flow categories, where `order` keeps deciding the
     * position. The slot is a stable spatial identity — it is what a future
     * slot hotkey will bind to — so it must not be recomputed from the array
     * index: a button hidden by its conditions leaves its slot empty instead
     * of letting the following buttons slide up.
     * Absent/invalid slots are repaired deterministically at render time by
     * placeButtonsOnGrid (src/utils/categoryGrid.ts), never by dropping data.
     */
    slot?: number;
}

/**
 * CategoryConfig 分类配置对象类型。
 * 包含分类信息和该分类下的所有按钮。
 */
export interface CategoryConfig {
    /** 分类唯一ID */
    id: string;
    /** 分类名称 */
    name: string;
    /** 分类在全局的排序值 */
    order: number;
    /** 分类下的按钮数组 */
    buttons: ButtonConfig[];
    /**
     * Optional declarative visibility condition (OCAP Context Engine), same
     * model as ButtonConfig.conditions. Absent/undefined = always visible.
     * In locked mode a category is rendered only when this condition holds
     * AND at least one of its buttons is context-visible; in sort/edit mode
     * the category stays rendered and manageable (visually marked).
     * Optional additive field: existing version-1 settings stay valid, so no
     * settingsVersion bump / migration step is required.
     */
    conditions?: ButtonCondition;
    /**
     * Button layout of this category.
     * - absent / 'flow': historical behavior — buttons render in `order`
     *   sequence and reflow whenever one is added, removed or context-hidden;
     * - 'grid': the 4x4 palette with 16 stable slots, where a hidden or
     *   removed button leaves its slot empty and nothing else moves.
     * Optional additive field: categories without it keep behaving exactly as
     * before, so no settingsVersion bump / migration step is required.
     * See src/utils/categoryGrid.ts for the slot semantics.
     */
    layout?: 'flow' | 'grid';
}

/** 交互模式：locked(锁定布局)、sort(排序模式)、edit(编辑模式) */
export type InteractionMode = 'locked' | 'sort' | 'edit';

/**
 * PanelConfig 面板设置类型。
 * 控制面板的标题、显示方式、布局等。
 */
export interface PanelConfig {
    /** 按钮显示样式（icon_left:图标在左文字在右，icon_top:图标在上文字在下） */
    displayStyle: 'icon_left' | 'icon_top';
    /** 面板视图类型（列表/标签页/文件夹） */
    panelViewType: 'list' | 'tabs' | 'folder';
    /** 是否启用按钮动画 */
    enableAnimation?: boolean;
    /** 悬浮按钮时是否显示完整名称提示 */
    showButtonTooltip?: boolean;
    /** 交互模式：locked(锁定布局) / sort(排序) / edit(编辑) */
    interactionMode?: InteractionMode;
    /** 是否显示顶部导航栏 */
    showTopNavBar?: boolean;
    /** 标签页是否自动换行 */
    tabsWrap?: boolean;
    /** 列表视图：是否在每次打开列表视图时默认折叠所有分类 */
    listAutoCollapse?: boolean;
    /** 文件夹视图：已展开文件夹名称是否可编辑 */
    folderDetailNameEditable?: boolean;
    /** 文件夹视图：是否显示按钮个数 */
    folderShowBtnCount?: boolean;
    /** 文件夹视图：点击空白处关闭 */
    folderCloseOnBlankClick?: boolean;
}

/**
 * PathConfig 路径设置类型。
 * 包含模板和脚本文件夹路径。
 */
export interface PathConfig {
    /** 模板文件夹路径 */
    templateFolderPath?: string;
    /** 脚本文件夹路径 */
    scriptFolderPath?: string;
}

/**
 * ButtonsPanelPluginSettings 插件全局设置类型。
 * 包含所有分类、面板设置等。
 */
export interface ButtonsPanelPluginSettings {
    /**
     * Settings schema version (see CURRENT_SETTINGS_VERSION).
     * Data without this field is treated as version 0 (unversioned upstream
     * data) and migrated by src/settings/settingsMigrations.ts.
     */
    settingsVersion: number;
    /** 分类数组 */
    categories: CategoryConfig[];
    /** 面板设置 */
    panelConfig: PanelConfig;
    /** 路径设置 */
    pathConfig: PathConfig;
}

/**
 * DEFAULT_SETTINGS 插件默认设置常量。
 * 提供插件初始化时的默认配置。
 */
export const DEFAULT_SETTINGS: ButtonsPanelPluginSettings = {
    settingsVersion: CURRENT_SETTINGS_VERSION,
    categories: [],
    panelConfig: {
        displayStyle: 'icon_top',
        panelViewType: 'list',
        enableAnimation: false,
        showButtonTooltip: true,
        interactionMode: 'edit',
        showTopNavBar: true,
        tabsWrap: false,
        listAutoCollapse: false,
        folderDetailNameEditable: true,
        folderShowBtnCount: true,
        folderCloseOnBlankClick: false,
    },
    pathConfig: {
        templateFolderPath: 'templates/',
        scriptFolderPath: 'scripts/',
    },
};

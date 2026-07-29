// ========== WOSAI 全局常量 ==========
// 版权、版本等跨模块共享的不可变值

/** 底部版权文案（全局唯一来源，修改此处即可同步所有面板） */
export const WOSAI_COPYRIGHT = "COPYRIGHT © WOSAI STUDIO | 穿山阅海";
export const WOSAI_GITHUB = "https://github.com/xujianjian2004";

/** localStorage 键名集中管理，避免魔法字符串散落各文件难以追踪 */
export const STORAGE_KEYS = {
    /** 帧率显示开关 */
    fps: "wosai-fps",
    /** 界面语言 */
    lang: "wosai-lang",
    /** 菜单隐藏开关 */
    menuHideEnabled: "wosai-menu-hide-enabled",
    /** 启动器显隐状态 */
    showLauncher: "WOSAI.ColorBar.ShowLauncher",
    /** 忽略组快捷键 */
    igShortcut: "wosai_ig_shortcut",
};

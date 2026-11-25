// Native settings provide one language and platform for the menu, windows and web content.
export function detectPlatform(userAgent = globalThis.navigator?.userAgent ?? '') {
  if (/windows/i.test(userAgent)) return 'windows';
  if (/macintosh|mac os x/i.test(userAgent)) return 'macos';
  return 'other';
}

export const desktopMessages = {
  en: {
    controlTitle: 'Araneae · Control Panel',
    petTitle: 'Araneae Desktop Companion',
    petArea: 'Desktop companion walking area',
    controlsLabel: 'Desktop companion controls',
    behavior: 'Behavior',
    modesLabel: 'Behavior modes',
    roam: 'Patrol',
    follow: 'Follow Pointer',
    observe: 'Observe',
    speed: 'Speed',
    size: 'Size',
    color: 'Color',
    colorDefault: 'Default',
    resetColor: 'Reset Color',
    colorPaletteLabel: 'Spider color palette',
    customColor: 'Custom color',
    spiderPresets: 'World’s Top 10 Spider Templates',
    spiderPresetsLabel: 'World’s top 10 famous spider color templates',
    presetBlackWidow: 'Black Widow',
    presetRedknee: 'Mexican Redknee',
    presetPeacock: 'Peacock Spider',
    presetWandering: 'Wandering Spider',
    presetFunnelWeb: 'Sydney Funnel-web',
    presetWolf: 'Wolf Spider',
    presetGoldenOrb: 'Golden Orb-Weaver',
    presetGoliath: 'Goliath Birdeater',
    presetHuntsman: 'Huntsman Spider',
    presetCrab: 'Crab Spider',
    allowCrossScreen: 'Allow Cross-Display Movement',
    avoidPointer: 'Avoid Pointer',
    autoStart: 'Launch at Startup',
    pause: 'Pause Ⅱ',
    resume: 'Resume ▷',
    hide: 'Hide Spider',
    show: 'Show Spider',
    command: '⌘ Command + click',
    noteBefore: 'Hold ',
    noteAfter: ' to dash to a destination. When cross-display movement is off, clicks, patrol and following stay on the spider’s current display. Commands are ignored while paused or hidden.',
    connecting: 'Connecting to the companion…',
    hiddenStatus: 'The spider is hidden. You can show it again at any time.',
    pausedStatus: 'Paused. Resume to restore movement and click commands.',
    readyStatus: 'Command-click to dash. Your mouse continues to work in other apps.',
    operationFailed: 'Could not complete the operation: ',
    petFailed: 'The companion encountered a problem. Quit Araneae from the eyes icon in the menu bar, then reopen it. ',
  },
  'zh-CN': {
    controlTitle: 'Araneae · 控制面板',
    petTitle: 'Araneae 桌宠',
    petArea: '桌宠爬行区域',
    controlsLabel: '桌宠控制面板',
    behavior: '行为控制',
    modesLabel: '行为模式',
    roam: '自主巡逻',
    follow: '跟随鼠标',
    observe: '原地观察',
    speed: '爬行速度',
    size: '身体大小',
    color: '外观颜色',
    colorDefault: '默认',
    resetColor: '重置颜色',
    colorPaletteLabel: '蜘蛛外观调色板',
    customColor: '自定义颜色',
    spiderPresets: '世界十大名蛛配色模板',
    spiderPresetsLabel: '世界十大知名蜘蛛配色模板',
    presetBlackWidow: '黑寡妇',
    presetRedknee: '红膝捕鸟蛛',
    presetPeacock: '孔雀跳蛛',
    presetWandering: '巴西游走蛛',
    presetFunnelWeb: '悉尼漏斗网',
    presetWolf: '狼蛛',
    presetGoldenOrb: '金丝圆网蛛',
    presetGoliath: '哥利亚食鸟蛛',
    presetHuntsman: '白额高脚蛛',
    presetCrab: '黄金蟹蛛',
    allowCrossScreen: '允许跨屏',
    avoidPointer: '躲避鼠标',
    autoStart: '开机自启动',
    pause: '暂停 Ⅱ',
    resume: '继续 ▷',
    hide: '隐藏蜘蛛',
    show: '显示蜘蛛',
    command: '⌘ Command + 单击',
    noteBefore: '按住 ',
    noteAfter: '，冲刺前往。关闭允许跨屏后，仅响应蜘蛛所在屏幕的点击，巡逻和跟随也限定在该屏幕。暂停或隐藏时不响应。',
    connecting: '正在连接桌宠…',
    hiddenStatus: '蜘蛛已隐藏，可随时重新显示。',
    pausedStatus: '已暂停，继续后恢复活动和点击互动。',
    readyStatus: '⌘ Command + 单击冲刺前往，鼠标可正常操作其他应用。',
    operationFailed: '操作未完成：',
    petFailed: '桌宠运行遇到问题。请从菜单栏的 Araneae 小眼睛图标退出后重新打开。',
  },
};

const platformOverrides = {
  windows: {
    en: {
      command: 'Ctrl + click',
      readyStatus: 'Ctrl-click to dash. Your mouse continues to work in other apps.',
      petFailed: 'The companion encountered a problem. Quit Araneae from the eyes icon in the system tray, then reopen it. ',
    },
    'zh-CN': {
      command: 'Ctrl + 单击',
      readyStatus: 'Ctrl + 单击冲刺前往，鼠标可正常操作其他应用。',
      petFailed: '桌宠运行遇到问题。请从系统托盘的 Araneae 小眼睛图标退出后重新打开。',
    },
  },
};

export function desktopStrings(language = 'en', platform = detectPlatform()) {
  const key = desktopMessages[language] ? language : 'en';
  const base = desktopMessages[key];
  const overrides = platformOverrides[platform]?.[key];
  return overrides ? {...base, ...overrides} : base;
}

export function localizeDesktop(document, language, platform = detectPlatform()) {
  const strings = desktopStrings(language, platform);
  document.documentElement.lang = language === 'zh-CN' ? 'zh-CN' : 'en';
  document.querySelectorAll('[data-i18n]').forEach(element => {
    element.textContent = strings[element.dataset.i18n];
  });
  document.querySelectorAll('[data-i18n-label]').forEach(element => {
    element.setAttribute('aria-label', strings[element.dataset.i18nLabel]);
  });
  return strings;
}

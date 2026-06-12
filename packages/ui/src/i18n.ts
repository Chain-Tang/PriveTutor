const en = {
  "dashboard.title": "Learning annotations",
  "dashboard.empty": "No annotations yet.",
  "dashboard.search": "Search annotations",
  "dashboard.allStatuses": "All statuses",
  "dashboard.allDocuments": "All documents",
  "dashboard.allConcepts": "All concepts",
  "dashboard.allReviews": "All review states",
  "dashboard.reviewed": "Reviewed",
  "dashboard.unreviewed": "Not reviewed",
  "dashboard.allTimes": "Any creation time",
  "dashboard.last7Days": "Last 7 days",
  "dashboard.last30Days": "Last 30 days",
  "action.open": "Open",
  "action.edit": "Edit",
  "action.review": "Review",
  "action.delete": "Delete",
  "action.deleteReview": "Delete review",
  "annotation.note": "Write your understanding first",
  "annotation.save": "Save only",
  "annotation.later": "Review later",
  "annotation.now": "Review now",
  "annotation.selected": "Selected source text",
  "review.title": "Agent review",
  "review.progress": "Reviewing your understanding...",
  "review.followUp": "Ask one follow-up",
  "onboarding.title": "Welcome to Annotation Tutor",
  "onboarding.description":
    "Write your understanding first, then let a locally authenticated Agent review it.",
  "onboarding.annotations": "Use annotations only",
  "onboarding.opencode": "Connect OpenCode",
  "onboarding.codex": "Connect Codex",
  "onboarding.developer": "Developer API mode"
} as const;

const zh: Record<keyof typeof en, string> = {
  "dashboard.title": "学习批注",
  "dashboard.empty": "还没有批注。",
  "dashboard.search": "搜索批注",
  "dashboard.allStatuses": "全部状态",
  "dashboard.allDocuments": "全部文档",
  "dashboard.allConcepts": "全部概念",
  "dashboard.allReviews": "全部批改状态",
  "dashboard.reviewed": "已批改",
  "dashboard.unreviewed": "未批改",
  "dashboard.allTimes": "不限创建时间",
  "dashboard.last7Days": "最近 7 天",
  "dashboard.last30Days": "最近 30 天",
  "action.open": "打开",
  "action.edit": "编辑",
  "action.review": "批改",
  "action.delete": "删除",
  "action.deleteReview": "删除批改",
  "annotation.note": "请先写下你自己的理解",
  "annotation.save": "只保存",
  "annotation.later": "稍后批改",
  "annotation.now": "立即批改",
  "annotation.selected": "选中的原文",
  "review.title": "Agent 批改",
  "review.progress": "正在批改你的理解……",
  "review.followUp": "追问一次",
  "onboarding.title": "欢迎使用 Annotation Tutor",
  "onboarding.description": "先写下自己的理解，再让本地已登录的 Agent 帮你批改。",
  "onboarding.annotations": "只使用批注功能",
  "onboarding.opencode": "连接 OpenCode",
  "onboarding.codex": "连接 Codex",
  "onboarding.developer": "开发者 API 模式"
};

export type TranslationKey = keyof typeof en | string;

export function createTranslator(locale: string) {
  const translations = locale.toLocaleLowerCase().startsWith("zh") ? zh : en;
  return (key: TranslationKey): string =>
    translations[key as keyof typeof en] ?? en[key as keyof typeof en] ?? key;
}

import type {
  StoryRecommendationContext,
  StoryRecommendationIntent,
  StoryRecommendationParameters,
  StoryRecommendationResourceSummary,
} from "./types";

const dailyBestTemplateKey = "memory_shot_daily_best_moments";

function clampScore(value: number) {
  return Math.max(0, Math.min(1, Number(value.toFixed(4))));
}

function countScore(count: number, target: number) {
  if (target <= 0) return 0;
  return clampScore(count / target);
}

function dailyDate(summary: StoryRecommendationResourceSummary, context: StoryRecommendationContext) {
  return summary.latestActivityAt?.slice(0, 10) ?? context.today;
}

function parameters(input: {
  templateKey: string | null;
  date: string | null;
  language: string;
  contentTypes: string[];
}): StoryRecommendationParameters {
  return {
    templateKey: input.templateKey,
    date: input.date,
    language: input.language,
    contentTypes: input.contentTypes,
  };
}

export const storyRecommendationIntents: StoryRecommendationIntent[] = [
  {
    key: "daily_best_moments",
    title: "今日最佳瞬间",
    description: "从照片、行程、地点和账本记录里整理今天最值得回看的片段。",
    requiredResources: ["photos", "memories", "planner_items"],
    parameterSchema: {
      templateKey: dailyBestTemplateKey,
      date: "YYYY-MM-DD",
      language: "string",
    },
    generateTemplateKey: dailyBestTemplateKey,
    score(summary, context) {
      const density =
        countScore(summary.photosCount, 6) * 0.28 +
        countScore(summary.memoriesCount, 6) * 0.26 +
        countScore(summary.plannerItemsCount, 4) * 0.18 +
        countScore(summary.expensesCount, 3) * 0.1 +
        countScore(summary.locationsCount, 3) * 0.08 +
        summary.recentActivityScore * 0.1;
      const score = clampScore(density);
      if (score < 0.18) return null;

      return {
        score,
        reason: "有足够的照片、记录或行程信息，适合生成一篇今日回顾故事。",
        parameters: parameters({
          templateKey: dailyBestTemplateKey,
          date: dailyDate(summary, context),
          language: context.language,
          contentTypes: ["photos", "memories", "route", "ledger"],
        }),
      };
    },
  },
  {
    key: "people_story",
    title: "人物同框故事",
    description: "把成员互动、合影和共同记忆整理成一篇人物故事。",
    requiredResources: ["people", "photos", "memories"],
    parameterSchema: {
      peopleCount: "number",
      date: "YYYY-MM-DD | null",
      language: "string",
    },
    generateTemplateKey: null,
    score(summary, context) {
      if (summary.peopleCount < 2) return null;
      const score = clampScore(
        countScore(summary.peopleCount, 4) * 0.35 +
          countScore(summary.photosCount, 8) * 0.25 +
          countScore(summary.memoriesCount, 8) * 0.25 +
          summary.recentActivityScore * 0.15,
      );
      if (score < 0.2) return null;
      return {
        score,
        reason: "旅程里有多位成员和共同素材，适合整理成人物关系故事。",
        parameters: parameters({
          templateKey: null,
          date: dailyDate(summary, context),
          language: context.language,
          contentTypes: ["people", "photos", "memories"],
        }),
      };
    },
  },
  {
    key: "group_story",
    title: "同行小队回顾",
    description: "把多人参与的行程、照片和记忆整理成一篇小队故事。",
    requiredResources: ["people", "planner_items", "memories"],
    parameterSchema: {
      peopleCount: "number",
      plannerItemsCount: "number",
      language: "string",
    },
    generateTemplateKey: null,
    score(summary, context) {
      if (summary.peopleCount < 2 || summary.plannerItemsCount < 2) return null;
      const score = clampScore(
        countScore(summary.peopleCount, 5) * 0.3 +
          countScore(summary.plannerItemsCount, 6) * 0.3 +
          countScore(summary.memoriesCount, 6) * 0.25 +
          summary.recentActivityScore * 0.15,
      );
      return {
        score,
        reason: "多人参与的行程和记忆已经形成，可以做一篇小队回顾。",
        parameters: parameters({
          templateKey: null,
          date: dailyDate(summary, context),
          language: context.language,
          contentTypes: ["people", "planner", "memories"],
        }),
      };
    },
  },
  {
    key: "route_story",
    title: "路线故事",
    description: "把地点、路线和当天移动轨迹整理成一篇路线回顾。",
    requiredResources: ["locations", "route", "planner_items"],
    parameterSchema: {
      routeAvailable: "boolean",
      locationsCount: "number",
      language: "string",
    },
    generateTemplateKey: null,
    score(summary, context) {
      if (!summary.routeAvailable && summary.locationsCount < 2) return null;
      const score = clampScore(
        (summary.routeAvailable ? 0.35 : 0.15) +
          countScore(summary.locationsCount, 5) * 0.35 +
          countScore(summary.plannerItemsCount, 5) * 0.2 +
          summary.recentActivityScore * 0.1,
      );
      return {
        score,
        reason: "旅程里有多个地点或路线线索，适合生成一篇移动路线故事。",
        parameters: parameters({
          templateKey: null,
          date: dailyDate(summary, context),
          language: context.language,
          contentTypes: ["route", "locations", "planner"],
        }),
      };
    },
  },
  {
    key: "spending_story",
    title: "花费小故事",
    description: "把账本里的消费、地点和成员参与整理成一篇轻量回顾。",
    requiredResources: ["expenses", "people"],
    parameterSchema: {
      expensesCount: "number",
      language: "string",
    },
    generateTemplateKey: null,
    score(summary, context) {
      if (summary.expensesCount < 2) return null;
      const score = clampScore(
        countScore(summary.expensesCount, 8) * 0.55 +
          countScore(summary.peopleCount, 4) * 0.2 +
          countScore(summary.locationsCount, 4) * 0.1 +
          summary.recentActivityScore * 0.15,
      );
      return {
        score,
        reason: "账本里已有多笔消费，可以整理成一篇旅程花费回顾。",
        parameters: parameters({
          templateKey: null,
          date: dailyDate(summary, context),
          language: context.language,
          contentTypes: ["ledger", "people", "locations"],
        }),
      };
    },
  },
];

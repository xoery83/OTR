export type Capture2Layer1Intent = "question" | "record" | "command" | "unknown";

export type Capture2RouteTarget =
  | "journey"
  | "navigation"
  | "ledger"
  | "planner"
  | "planner_page"
  | "ledger_page"
  | "mutation"
  | "unknown";

export type Capture2Rule = {
  id: string;
  patterns: RegExp[];
  confidence: number;
  reason: string;
  target?: Capture2RouteTarget;
};

export const questionBehaviorRules: Capture2Rule[] = [
  {
    id: "look_check_show",
    patterns: [
      /(?:帮我|让我|给我)?\s*(?:看一下|看看|看下|查看|查一下|查查|查下|显示|告诉我)/i,
    ],
    confidence: 0.92,
    reason: "Question behavior verb matched.",
  },
  {
    id: "remaining_schedule",
    patterns: [/(?:还有什么|都有什么|有没有|有哪些|是不是有|是否有)/i],
    confidence: 0.9,
    reason: "Question sentence shape matched.",
  },
  {
    id: "interrogative",
    patterns: [/(?:几点|什么时候|住哪里|住哪|在哪里|在哪|为什么|多少|怎么|什么)[？?]?$/i],
    confidence: 0.9,
    reason: "Interrogative phrase matched.",
  },
  {
    id: "question_mark",
    patterns: [/[？?]\s*$/],
    confidence: 0.86,
    reason: "Question mark matched.",
  },
];

export const commandBehaviorRules: Capture2Rule[] = [
  {
    id: "navigation_command",
    patterns: [/(?:导航去|导航到|带我去|打开地图去|地图搜|地图搜索|导航|打开地图)/i],
    confidence: 0.94,
    reason: "Navigation command verb matched.",
    target: "navigation",
  },
  {
    id: "open_planner",
    patterns: [/(?:打开|进入|去)\s*(?:planner|计划|行程|日程|安排)(?:页面|表)?$/i],
    confidence: 0.88,
    reason: "Open Planner command matched.",
    target: "planner_page",
  },
  {
    id: "open_ledger",
    patterns: [/(?:打开|进入|去)\s*(?:ledger|账本|费用|消费)(?:页面|表)?$/i],
    confidence: 0.88,
    reason: "Open Ledger command matched.",
    target: "ledger_page",
  },
  {
    id: "create_expense",
    patterns: [
      /(?:新增|添加|加一个|记一笔|记录|录入|写一笔).*(?:消费|费用|账|支出|花费|停车|加油|油费|午饭|晚饭|早餐|咖啡|门票|票)/i,
      /(?:消费|费用|账|支出|花费).*(?:新增|添加|记一笔|记录|录入)/i,
    ],
    confidence: 0.9,
    reason: "Create expense command matched.",
    target: "ledger",
  },
  {
    id: "create_plan",
    patterns: [
      /(?:新增|添加|加一个|记录|录入|安排).*(?:行程|计划|活动|预订|预约|酒店|住宿|机票|航班|船票|渡轮|门票|booking|hotel|flight|ferry|plan|schedule)/i,
      /(?:行程|计划|活动|预订|预约|酒店|住宿|机票|航班|船票|渡轮|门票).*(?:新增|添加|记录|录入|安排|帮我录入)/i,
    ],
    confidence: 0.9,
    reason: "Create planner command matched.",
    target: "planner",
  },
  {
    id: "mutation_command",
    patterns: [
      /(?:修改|改一下|再改|撤销|删除|删掉|取消).*(?:刚才|上一条|那条|那个|这个|它)/i,
      /(?:刚才|上一条|那条|那个|这个|它).*(?:调出来|找出来|打开).*(?:修改|改一下|再改)/i,
      /(?:调出来|找出来|打开).*(?:刚才|上一条|那条|那个|这个|它).*(?:修改|改一下|再改)/i,
    ],
    confidence: 0.82,
    reason: "Mutation command requires confirmation.",
    target: "mutation",
  },
];

export const sentenceShapeRules: Capture2Rule[] = [
  {
    id: "expense_shorthand",
    patterns: [
      /(?:停车|加油|油费|午饭|晚饭|早餐|咖啡|餐厅|门票|船票|机票|打车|出租|uber|bolt|消费|花了|支付|付了|买|购物|fuel|parking|lunch|dinner|coffee|ticket).*\d+(?:[.,]\d+)?/i,
      /\d+(?:[.,]\d+)?.*(?:欧元|欧|美元|美金|英镑|日元|人民币|元|纽币|新西兰元|澳元|丹麦克朗|eur|usd|gbp|jpy|cny|rmb|nzd|aud|dkk).*(?:停车|加油|午饭|晚饭|早餐|咖啡|门票|打车|消费|购物|票)/i,
      /(?:停车|加油|油费|午饭|晚饭|早餐|咖啡|餐厅|门票|船票|机票|打车|出租|消费|花了|支付|付了|买|购物).*(?:零|一|二|两|三|四|五|六|七|八|九|十|百|千|万)+(?:点(?:零|一|二|两|三|四|五|六|七|八|九)+)?\s*(?:欧元|欧|美元|美金|英镑|日元|人民币|元|纽币|新西兰元|澳元|丹麦克朗)/i,
    ],
    confidence: 0.9,
    reason: "Expense shorthand with amount matched.",
    target: "ledger",
  },
  {
    id: "booking_statement",
    patterns: [
      /(?:订了|定了|预订|订好|定好|booking|booked|买了).*(?:酒店|住宿|hotel|机票|航班|飞机|flight|船票|渡轮|ferry|门票|票|ticket)/i,
      /(?:酒店|住宿|hotel|机票|航班|flight|船票|ferry|门票|ticket).*(?:订了|定了|预订|订好|定好|booking|booked|买了|录入)/i,
    ],
    confidence: 0.86,
    reason: "Booking statement matched.",
    target: "planner",
  },
];

export const recordSignalRules: Capture2Rule[] = [
  {
    id: "life_event_statement",
    patterns: [
      /(?:今天|刚才|终于|差点|感觉|觉得|这里|这家|这个|我们|bao|leon|我).*(?:到了|看到|遇到|摔倒|下雨|风|不错|好吃|漂亮|开心|累|冷|热|喜欢|记得)/i,
    ],
    confidence: 0.62,
    reason: "Record-like travel statement matched.",
  },
];

export const queryTargetRules: Capture2Rule[] = [
  {
    id: "journey_itinerary_query",
    patterns: [/(?:行程|形成|安排|活动|计划|日程|瀑布|酒店|住宿|住哪里|住哪|出发|到达)/i],
    confidence: 0.93,
    reason: "Question routed to Journey context.",
    target: "journey",
  },
  {
    id: "journey_cost_query",
    patterns: [/(?:花了多少|多少钱|费用|消费|账本|ledger|预算)/i],
    confidence: 0.88,
    reason: "Question routed to Journey context.",
    target: "journey",
  },
  {
    id: "journey_weather_query",
    patterns: [/(?:天气|下雨|刮风|风大|温度|冷不冷|热不热)/i],
    confidence: 0.86,
    reason: "Question routed to Journey context.",
    target: "journey",
  },
];

export const expenseCategoryRules: Array<[RegExp, string]> = [
  [/停车|公交|地铁|打车|出租|uber|bolt|taxi|交通/i, "transport"],
  [/加油|油费|fuel|petrol|gas/i, "fuel"],
  [/午饭|晚饭|早餐|咖啡|餐厅|饭|吃|meal|lunch|dinner|coffee/i, "food"],
  [/酒店|住宿|hotel/i, "hotel"],
  [/门票|票|ticket|tour/i, "ticket"],
  [/购物|买|shopping/i, "shopping"],
  [/租车|car/i, "car"],
  [/航班|机票|flight/i, "flight"],
];

export const currencyRules: Array<[RegExp, string]> = [
  [/欧元|欧|eur\b/i, "EUR"],
  [/美元|美金|usd\b/i, "USD"],
  [/英镑|gbp\b/i, "GBP"],
  [/日元|jpy\b/i, "JPY"],
  [/人民币|rmb|cny\b|元\b/i, "CNY"],
  [/纽币|新西兰元|nzd\b/i, "NZD"],
  [/澳元|aud\b/i, "AUD"],
  [/丹麦克朗|dkk\b/i, "DKK"],
];

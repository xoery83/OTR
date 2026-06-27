import { parseLocalItinerary } from "../src/lib/planner-import-local";
import { toPlannerDrafts } from "../src/lib/planner-import";

type ExpectedReservation = {
  type: string;
  title: string;
  startsAt: string | null;
  locationIncludes: string;
  participants?: string[];
};

type TestCase = {
  name: string;
  input: string;
  expected: ExpectedReservation[];
};

const multiHotelInput = `Mary
Dates: 2026-07-09 to 2026-07-13
Location: Reykholt, Bláskógabyggð 801, Iceland
Hotel: Golden circle house with hot tub
Platform: Bao / Airbnb
Phone: +354 696 5652

Hotel stay
Guests: Yang Li, Guoxiang Chen, Qizhi Chen, Tian Xin, Qianyu Li, Bao,
Mary
Dates: 2026-07-13 to 2026-07-15
Location: StóraMörk 3, Hvolsvöllur, Rangárþing eystra 861, Iceland
Hotel: Apartment with balcony
Platform: Bao / Airbnb
Phone: +354 852 3249

Hotel stay
Guests: Yang Li, Guoxiang Chen, Qizhi Chen, Tian Xin, Qianyu Li, Bao,
Mary
Dates: 2026-07-15 to 2026-07-17
Location: Hraunhóll 7, 781 Höfn, Iceland
Hotel: Haukaberg House
Platform: Bao / Booking
Phone: +354 845 4146`;

const multiFlightInput = `Yang Li / Guoxiang Chen / Qizhi Chen
2026-07-08 00:05
Flight NZ3352
Singapore (SIN) → Copenhagen (CPH)

Yang Li / Guoxiang Chen / Qizhi Chen
2026-07-08 16:55
Flight FI209
Copenhagen (CPH) → Keflavik (KEF)

Yang Li / Guoxiang Chen / Qizhi Chen
2026-07-24 08:05
Flight FI123
Keflavik (KEF) → Ilulissat (JAV)`;

const accommodationExpenseInput = `Accommodation Expense

Check-in: 2026-07-08
Check-out: 2026-07-09

Hotel:
Nice house in midtown Hafnarfjordur with hot tub

Address:
Garðavegur 6, Hafnarfjörður, Iceland

Amount:
4713.28 CNY

Paid by:
Bao

Split with:
Bao
Mary
Yang Li
Guoxiang Chen
Qizhi Chen
Xin Tian
Qianyu Li

Category:
Accommodation

Linked stay:
2026-07-08 → 2026-07-09`;

const naturalAccommodationExpenseInput =
  "Bao paid 19,395.79 CNY for Golden Circle House with Hot Tub in Reykholt, Iceland. We stayed from 9 Jul to 13 Jul 2026. Split equally among Bao, Mary, Yang Li, Guoxiang Chen, Qizhi Chen, Xin Tian and Qianyu Li.";

const multiAccommodationExpenseInput = `${accommodationExpenseInput}

Accommodation Expense

Check-in: 2026-07-15
Check-out: 2026-07-17

Hotel:
Haukaberg House

Address:
Hraunhóll 7, 781 Höfn, Iceland

Amount:
(Price unavailable)

Paid by:
Bao

Split with:
Bao
Mary
Yang Li
Guoxiang Chen
Qizhi Chen
Xin Tian
Qianyu Li

Category:
Accommodation

Linked stay:
2026-07-15 → 2026-07-17

Accommodation Expense

Check-in: 2026-07-17
Check-out: 2026-07-20

Hotel:
Accommodation in a beautiful environment

Address:
Eidagisting Guesthouse, Egilsstaðir 701, Iceland

Amount:
17326.31 CNY

Paid by:
Bao

Split with:
Bao
Mary
Yang Li
Guoxiang Chen
Qizhi Chen
Xin Tian
Qianyu Li

Category:
Accommodation

Linked stay:
2026-07-17 → 2026-07-20`;

const dailyPlanInput = `# Day 1｜2026-07-08｜抵达冰岛

15:35 Bao、Mary 抵达凯夫拉维克国际机场（KEF）。

15:40 田欣、Caroline 抵达凯夫拉维克国际机场（KEF）。

16:00 在 KEF Airport 的 Lotus Car Rental 办理取车，驾驶人：Bao。

16:10 前往 Costco Reykjavík 采购未来四天（Golden Circle）所需食材及生活用品。

17:10 前往 Bónus 超市补充亚洲食品、饮料及日用品。

18:10 Yang Li、祥哥、Grace 抵达凯夫拉维克国际机场（KEF）。

18:20 前往机场接第二批抵达成员。

19:10 全员前往 Hafnarfjörður 住宿。

20:00 晚餐，可就近选择 Icelandic Street Food 或其他餐厅。

21:00 办理入住、整理行李、确认车辆及物资，讨论明日 Golden Circle 行程。

注意事项：
- Golden Circle 区域超市较少，今天一次性采购未来四天食材。
- 离开雷克雅未克前建议加满油。
- 提前下载离线地图，确保山区无网络时可正常导航。
- 检查相机、电池、无人机及充电设备，为明天拍摄做好准备。`;

const dailyPlanWithAddressesInput = `# Day 5｜2026-07-12｜南岸瀑布 & 黑沙滩

08:30 🍳 Airbnb 早餐，准备当天行程。

09:00 🚗 从 Airbnb 出发，前往冰岛南岸。

09:45 💧 游览 Seljalandsfoss 塞里雅兰瀑布
地址：Seljalandsfoss, 861 Hvolsvöllur, Iceland

11:15 🌊 游览 Skógafoss 斯科加瀑布
地址：Skógafoss, Skógar, 861, Iceland

12:15 🍴 午餐。

13:20 🏖️ 游览 Reynisfjara 黑沙滩
地址：Reynisfjara Beach, 871 Vík, Iceland

14:40 🏘️ 前往 Vík 小镇自由活动
地址：Vík í Mýrdal, 870 Vík, Iceland

17:00 🚗 返回 Airbnb。

18:30 🏨 回到住宿，休息。

19:30 🍖 Airbnb 自己做晚餐。

21:00 ♨️ 泡 Hot Tub，整理照片，休息。

注意事项：
- Seljalandsfoss 水雾较大，建议准备防水外套。
- Reynisfjara 黑沙滩注意 Sneaker Waves（疯狗浪），不要靠近海边。
- 今日往返约220公里，离开住宿前建议加满油。`;

const dailyPlanWithParticipantsInput = `# Day 17｜2026-07-24｜格陵兰分队日

08:00 ✈️ A组前往格陵兰（Ilulissat）。
参与人：Bao、Mary、Yang Li、Guoxiang Chen、Qizhi Chen

08:00 🏨 B组继续入住 Hotel Boli Keflavík，自由活动。
参与人：田欣、Caroline

10:30 🏨 A组抵达 Ilulissat Airport。
参与人：Bao、Mary、Yang Li、Guoxiang Chen、QizhiChen

11:00 🚗 A组领取租车。
地址：Ilulissat Airport Car Rental, Ilulissat, Greenland
参与人：Bao、Mary、Yang Li、Guoxiang Chen、Qizhi Chen

11:30 🏨 办理入住酒店。
参与人：Bao、Mary、Guoxiang Chen、Qizhi Chen
地址：Hotel Arctic, Mittarfimmut B 1128, 3952 Ilulissat, Greenland

11:30 🏨 办理入住酒店。
参与人：Yang Li
地址：HOTEL SØMA Ilulissat, Nuussuattaap Aqq. 2, 3952 Ilulissat, Greenland

13:00 🍴 A组午餐，自由活动。

15:00 🚶 漫步 Ilulissat 小镇，熟悉环境，欣赏冰山海湾风光。
地址：Ilulissat Town Centre, 3952 Ilulissat, Greenland

19:00 🍽️ A组晚餐。

21:00 🌅 欣赏午夜阳光，返回住宿休息。

---

09:30 ☕ B组酒店早餐，自由休息。
参与人：田欣、Caroline

13:00 🚗【可选】前往 Blue Lagoon。
地址：Blue Lagoon Iceland, Norðurljósavegur 9, 240 Grindavík, Iceland
参与人：田欣、Caroline

18:00 🍽️ B组晚餐。

21:00 🌅 返回 Hotel Boli Keflavík 休息。

注意事项：
- A组进入格陵兰后，时区比冰岛晚1小时，请注意调整时间。
- Ilulissat 步行即可游览大部分城区，但天气变化快，请携带保暖、防风外套。
- B组无需退房，可轻松安排自由活动，为返程做好准备。`;

const carRentalInput = "添加一个租车预订信息， Lotus Car Rental， 跨越时间 78 - 724";

const cases: TestCase[] = [
  {
    name: "single hotel block",
    input: `Hotel stay
Guests: Yang Li, Guoxiang Chen, Qizhi Chen, Tian Xin, Qianyu Li, Bao, Mary
Dates: 2026-07-08 to 2026-07-09
Location: Garðavegur 6, Hafnarfjörður, Iceland
Hotel: Nice house in midtown Hafnarfjordur with hot tub
Platform: Bao / Airbnb
Phone: +354 824 6964`,
    expected: [
      {
        type: "hotel",
        title: "Nice house in midtown Hafnarfjordur with hot tub",
        startsAt: "2026-07-08T15:00:00",
        locationIncludes: "Garðavegur 6",
        participants: ["Yang Li", "Guoxiang Chen", "Qizhi Chen", "Tian Xin", "Qianyu Li", "Bao", "Mary"],
      },
    ],
  },
  {
    name: "multiple hotel blocks",
    input: multiHotelInput,
    expected: [
      {
        type: "hotel",
        title: "Golden circle house with hot tub",
        startsAt: "2026-07-09T15:00:00",
        locationIncludes: "Reykholt",
        participants: [],
      },
      {
        type: "hotel",
        title: "Apartment with balcony",
        startsAt: "2026-07-13T15:00:00",
        locationIncludes: "StóraMörk 3",
        participants: ["Yang Li", "Guoxiang Chen", "Qizhi Chen", "Tian Xin", "Qianyu Li", "Bao", "Mary"],
      },
      {
        type: "hotel",
        title: "Haukaberg House",
        startsAt: "2026-07-15T15:00:00",
        locationIncludes: "Hraunhóll 7",
        participants: ["Yang Li", "Guoxiang Chen", "Qizhi Chen", "Tian Xin", "Qianyu Li", "Bao", "Mary"],
      },
    ],
  },
  {
    name: "multiple flight blocks",
    input: multiFlightInput,
    expected: [
      {
        type: "flight",
        title: "Flight NZ3352",
        startsAt: "2026-07-08T00:05:00",
        locationIncludes: "Singapore (SIN)",
      },
      {
        type: "flight",
        title: "Flight FI209",
        startsAt: "2026-07-08T16:55:00",
        locationIncludes: "Copenhagen (CPH)",
      },
      {
        type: "flight",
        title: "Flight FI123",
        startsAt: "2026-07-24T08:05:00",
        locationIncludes: "Keflavik (KEF)",
      },
    ],
  },
  {
    name: "chinese car rental shorthand date range",
    input: carRentalInput,
    expected: [
      {
        type: "car",
        title: "Lotus Car Rental",
        startsAt: "2026-07-08T09:00:00",
        locationIncludes: "Lotus Car Rental",
        participants: [],
      },
    ],
  },
  {
    name: "mixed flight and hotel blocks",
    input: `${multiFlightInput}

Hotel stay
Dates: 2026-07-08 to 2026-07-09
Location: Garðavegur 6, Hafnarfjörður, Iceland
Hotel: Nice house in midtown Hafnarfjordur with hot tub`,
    expected: [
      {
        type: "flight",
        title: "Flight NZ3352",
        startsAt: "2026-07-08T00:05:00",
        locationIncludes: "Singapore (SIN)",
      },
      {
        type: "flight",
        title: "Flight FI209",
        startsAt: "2026-07-08T16:55:00",
        locationIncludes: "Copenhagen (CPH)",
      },
      {
        type: "flight",
        title: "Flight FI123",
        startsAt: "2026-07-24T08:05:00",
        locationIncludes: "Keflavik (KEF)",
      },
      {
        type: "hotel",
        title: "Nice house in midtown Hafnarfjordur with hot tub",
        startsAt: "2026-07-08T15:00:00",
        locationIncludes: "Garðavegur 6",
      },
    ],
  },
];

function assertCase(testCase: TestCase) {
  const result = parseLocalItinerary(testCase.input);
  const reservations = result?.reservations ?? [];

  if (reservations.length !== testCase.expected.length) {
    throw new Error(
      `${testCase.name}: expected ${testCase.expected.length} reservations, got ${reservations.length}`,
    );
  }

  testCase.expected.forEach((expected, index) => {
    const actual = reservations[index];
    if (actual.reservation_type !== expected.type) {
      throw new Error(`${testCase.name}: reservation ${index + 1} type mismatch`);
    }
    if (actual.title !== expected.title) {
      throw new Error(`${testCase.name}: reservation ${index + 1} title mismatch`);
    }
    if (actual.starts_at !== expected.startsAt) {
      throw new Error(`${testCase.name}: reservation ${index + 1} start mismatch`);
    }
    if (!actual.location_name?.includes(expected.locationIncludes)) {
      throw new Error(`${testCase.name}: reservation ${index + 1} location mismatch`);
    }
    if (expected.participants) {
      const actualParticipants = actual.participant_names ?? [];
      if (actualParticipants.join("|") !== expected.participants.join("|")) {
        throw new Error(`${testCase.name}: reservation ${index + 1} participants mismatch`);
      }
    }
  });
}

cases.forEach(assertCase);

const carRentalResult = parseLocalItinerary(carRentalInput);
const carRentalReservation = carRentalResult?.reservations?.[0];
if (carRentalReservation?.ends_at !== "2026-07-24T18:00:00") {
  throw new Error("car rental shorthand date range should parse the return date");
}
if ((carRentalReservation?.participant_names ?? []).length > 0) {
  throw new Error("car rental without driver should not default to any participant");
}

const multiAccommodationExpenseResult = parseLocalItinerary(multiAccommodationExpenseInput);
if ((multiAccommodationExpenseResult?.reservations ?? []).length > 0) {
  throw new Error("multi accommodation expense import should not create reservation drafts");
}
const multiAccommodationExpenses = multiAccommodationExpenseResult?.expenses ?? [];
if (multiAccommodationExpenses.length !== 3) {
  throw new Error(
    `multi accommodation expense import should create 3 expense drafts, got ${multiAccommodationExpenses.length}`,
  );
}
if (
  multiAccommodationExpenses[2]?.title !==
    "Accommodation in a beautiful environment accommodation" ||
  multiAccommodationExpenses[2]?.original_amount !== 17326.31 ||
  multiAccommodationExpenses[2]?.original_currency !== "CNY"
) {
  throw new Error("multi accommodation expense import should parse the latest expense fields");
}
if (
  multiAccommodationExpenses[1]?.title !== "Haukaberg House accommodation" ||
  multiAccommodationExpenses[1]?.original_amount !== null ||
  multiAccommodationExpenses[1]?.needs_review !== true
) {
  throw new Error("price unavailable accommodation expense should remain as a review draft");
}

const dailyPlanResult = parseLocalItinerary(dailyPlanInput);
const dailyPlanEvents = dailyPlanResult?.events ?? [];
if (dailyPlanEvents.length !== 10) {
  throw new Error(`daily plan import should create 10 event drafts, got ${dailyPlanEvents.length}`);
}
if (
  dailyPlanEvents[0]?.day_date !== "2026-07-08" ||
  dailyPlanEvents[0]?.day_title !== "抵达冰岛" ||
  dailyPlanEvents[0]?.planned_start !== "2026-07-08T15:35:00" ||
  dailyPlanEvents[0]?.event_type !== "flight" ||
  !dailyPlanEvents[0]?.participant_names?.includes("Bao") ||
  !dailyPlanEvents[0]?.participant_names?.includes("Mary")
) {
  throw new Error("daily plan first arrival event fields mismatch");
}
if (
  dailyPlanEvents[2]?.event_type !== "car" ||
  !dailyPlanEvents[2]?.participant_names?.includes("Bao")
) {
  throw new Error("daily plan car rental event should preserve driver as participant");
}
if (dailyPlanEvents[3]?.event_type !== "shopping") {
  throw new Error("daily plan grocery event should be classified as shopping");
}
if (!dailyPlanEvents[9]?.day_notes?.includes("提前下载离线地图")) {
  throw new Error("daily plan notes should be attached to event day notes");
}

const dailyPlanWithAddressesResult = parseLocalItinerary(dailyPlanWithAddressesInput);
const dailyPlanWithAddressesEvents = dailyPlanWithAddressesResult?.events ?? [];
if (dailyPlanWithAddressesEvents.length !== 11) {
  throw new Error(
    `daily plan address import should create 11 event drafts, got ${dailyPlanWithAddressesEvents.length}`,
  );
}
[
  ["Seljalandsfoss, 861 Hvolsvöllur, Iceland", 2],
  ["Skógafoss, Skógar, 861, Iceland", 3],
  ["Reynisfjara Beach, 871 Vík, Iceland", 5],
  ["Vík í Mýrdal, 870 Vík, Iceland", 6],
].forEach(([expectedLocation, index]) => {
  const actual = dailyPlanWithAddressesEvents[Number(index)];
  if (actual?.location_name !== expectedLocation) {
    throw new Error(
      `daily plan address event ${Number(index) + 1} location mismatch: ${actual?.location_name}`,
    );
  }
  if (!actual.source_excerpt?.includes("地址：")) {
    throw new Error("daily plan address source excerpt should include the address line");
  }
});

const dailyPlanWithParticipantsResult = parseLocalItinerary(dailyPlanWithParticipantsInput);
const dailyPlanWithParticipantsEvents = dailyPlanWithParticipantsResult?.events ?? [];
if (dailyPlanWithParticipantsEvents.length !== 14) {
  throw new Error(
    `daily plan participant import should create 14 event drafts, got ${dailyPlanWithParticipantsEvents.length}`,
  );
}
if (
  dailyPlanWithParticipantsEvents[0]?.participant_names?.join("|") !==
  "Bao|Mary|Yang Li|Guoxiang Chen|Qizhi Chen"
) {
  throw new Error("daily plan participant line should populate A group participants");
}
if (
  dailyPlanWithParticipantsEvents[1]?.participant_names?.join("|") !==
  "田欣|Caroline"
) {
  throw new Error("daily plan participant line should populate B group participants");
}
if (
  dailyPlanWithParticipantsEvents[3]?.location_name !==
    "Ilulissat Airport Car Rental, Ilulissat, Greenland" ||
  !dailyPlanWithParticipantsEvents[3]?.participant_names?.includes("Guoxiang Chen")
) {
  throw new Error("daily plan participant/address block should preserve car rental fields");
}
if (
  dailyPlanWithParticipantsEvents[4]?.location_name !==
    "Hotel Arctic, Mittarfimmut B 1128, 3952 Ilulissat, Greenland" ||
  dailyPlanWithParticipantsEvents[4]?.participant_names?.includes("Yang Li")
) {
  throw new Error("daily plan first hotel block should keep only listed participants");
}
if (
  dailyPlanWithParticipantsEvents[5]?.location_name !==
    "HOTEL SØMA Ilulissat, Nuussuattaap Aqq. 2, 3952 Ilulissat, Greenland" ||
  dailyPlanWithParticipantsEvents[5]?.participant_names?.join("|") !== "Yang Li"
) {
  throw new Error("daily plan second hotel block should keep Yang Li only");
}
if (
  dailyPlanWithParticipantsEvents[11]?.location_name !==
    "Blue Lagoon Iceland, Norðurljósavegur 9, 240 Grindavík, Iceland" ||
  dailyPlanWithParticipantsEvents[11]?.participant_names?.join("|") !==
    "田欣|Caroline"
) {
  throw new Error("daily plan optional Blue Lagoon block should keep B group participants and address");
}

const parsedDrafts = toPlannerDrafts(
  parseLocalItinerary(`Hotel stay
Guests: Yang Li, Guoxiang Chen, Qizhi Chen, Bao, Mary
Dates: 2026-07-27 to 2026-07-31
Location: Kuunnguarsuup Qaava 1, 3952 Ilulissat, Greenland
Hotel: Apartment in Ilulissat - by Pilu & Kaali`) ?? {},
  [],
  [
    {
      id: "jm-yang",
      tripId: "trip",
      userId: null,
      displayName: "Yang Li",
      avatarUrl: null,
      role: "group_member",
      status: "unlinked",
      notes: "",
      inviteEmail: null,
      linkedAt: null,
      createdAt: "",
    },
    {
      id: "jm-guoxiang",
      tripId: "trip",
      userId: null,
      displayName: "Guoxiang Chen",
      avatarUrl: null,
      role: "group_member",
      status: "unlinked",
      notes: "祥哥",
      inviteEmail: null,
      linkedAt: null,
      createdAt: "",
    },
    {
      id: "jm-qizhi",
      tripId: "trip",
      userId: null,
      displayName: "Qizhi Chen",
      avatarUrl: null,
      role: "group_member",
      status: "unlinked",
      notes: "",
      inviteEmail: null,
      linkedAt: null,
      createdAt: "",
    },
    {
      id: "jm-bao",
      tripId: "trip",
      userId: null,
      displayName: "Bao",
      avatarUrl: null,
      role: "group_member",
      status: "unlinked",
      notes: "",
      inviteEmail: null,
      linkedAt: null,
      createdAt: "",
    },
    {
      id: "jm-mary",
      tripId: "trip",
      userId: null,
      displayName: "Mary",
      avatarUrl: null,
      role: "group_member",
      status: "unlinked",
      notes: "",
      inviteEmail: null,
      linkedAt: null,
      createdAt: "",
    },
    {
      id: "jm-tx",
      tripId: "trip",
      userId: null,
      displayName: "Tian Xin",
      avatarUrl: null,
      role: "group_member",
      status: "unlinked",
      notes: "TX",
      inviteEmail: null,
      linkedAt: null,
      createdAt: "",
    },
  ],
);

const unmatchedKnownMembers = parsedDrafts.reservations[0]?.unmatched_participant_names ?? [];
if (unmatchedKnownMembers.length > 0) {
  throw new Error(
    `known journey members should not be unmatched: ${unmatchedKnownMembers.join(", ")}`,
  );
}

const akaDrafts = toPlannerDrafts(
  {
    reservations: [
      {
        reservation_type: "hotel",
        title: "TBC",
        day_date: "2026-07-26",
        location_name: "Shanghai Pudong",
        starts_at: "2026-07-26T15:00:00",
        ends_at: "2026-07-27T11:00:00",
        participant_names: ["TX"],
      },
    ],
  },
  [],
  [
    {
      id: "jm-tx",
      tripId: "trip",
      userId: null,
      displayName: "Tian Xin",
      avatarUrl: null,
      role: "group_member",
      status: "unlinked",
      notes: "TX",
      inviteEmail: null,
      linkedAt: null,
      createdAt: "",
    },
  ],
);

if (akaDrafts.reservations[0]?.participant_names.join("|") !== "Tian Xin") {
  throw new Error("AKA participant names should be canonicalized to journey member names");
}

const expenseDrafts = toPlannerDrafts(
  parseLocalItinerary(accommodationExpenseInput) ?? {},
  [],
  [
    {
      id: "jm-yang",
      tripId: "trip",
      userId: null,
      displayName: "Leon Li",
      avatarUrl: null,
      role: "group_member",
      status: "unlinked",
      notes: "Leon 李旸",
      inviteEmail: null,
      linkedAt: null,
      createdAt: "",
    },
    {
      id: "jm-guoxiang",
      tripId: "trip",
      userId: null,
      displayName: "Guoxiang Chen",
      avatarUrl: null,
      role: "group_member",
      status: "unlinked",
      notes: "祥哥",
      inviteEmail: null,
      linkedAt: null,
      createdAt: "",
    },
    {
      id: "jm-qizhi",
      tripId: "trip",
      userId: null,
      displayName: "Qizhi Chen",
      avatarUrl: null,
      role: "group_member",
      status: "unlinked",
      notes: "",
      inviteEmail: null,
      linkedAt: null,
      createdAt: "",
    },
    {
      id: "jm-bao",
      tripId: "trip",
      userId: null,
      displayName: "Bao",
      avatarUrl: null,
      role: "group_member",
      status: "unlinked",
      notes: "",
      inviteEmail: null,
      linkedAt: null,
      createdAt: "",
    },
    {
      id: "jm-mary",
      tripId: "trip",
      userId: null,
      displayName: "Mary",
      avatarUrl: null,
      role: "group_member",
      status: "unlinked",
      notes: "",
      inviteEmail: null,
      linkedAt: null,
      createdAt: "",
    },
    {
      id: "jm-tian",
      tripId: "trip",
      userId: null,
      displayName: "TX",
      avatarUrl: null,
      role: "group_member",
      status: "unlinked",
      notes: "TX",
      inviteEmail: null,
      linkedAt: null,
      createdAt: "",
    },
    {
      id: "jm-qianyu",
      tripId: "trip",
      userId: null,
      displayName: "Caroline",
      avatarUrl: null,
      role: "group_member",
      status: "unlinked",
      notes: "Caroline Li 李芊羽",
      inviteEmail: null,
      linkedAt: null,
      createdAt: "",
    },
  ],
);

if (expenseDrafts.reservations.length > 0) {
  throw new Error("accommodation expense should not create a reservation draft");
}

const accommodationExpense = expenseDrafts.expenses[0];
if (!accommodationExpense) {
  throw new Error("accommodation expense should parse as an expense draft");
}
if (
  accommodationExpense.original_amount !== 4713.28 ||
  accommodationExpense.original_currency !== "CNY" ||
  accommodationExpense.category !== "hotel"
) {
  throw new Error("accommodation expense amount, currency, or category mismatch");
}
if (accommodationExpense.payer_member_id !== "jm-bao") {
  throw new Error("accommodation expense payer should match Bao");
}
if (!accommodationExpense.participant_member_ids.includes("jm-yang")) {
  throw new Error("Yang Li should match Leon Li as a split participant");
}
if (!accommodationExpense.participant_member_ids.includes("jm-tian")) {
  throw new Error("Xin Tian should match TX as a split participant");
}
if (!accommodationExpense.participant_member_ids.includes("jm-qianyu")) {
  throw new Error("Qianyu Li should match Caroline as a split participant");
}

const naturalExpenseDrafts = toPlannerDrafts(
  parseLocalItinerary(naturalAccommodationExpenseInput) ?? {},
  [],
  [
    {
      id: "jm-bao",
      tripId: "trip",
      userId: null,
      displayName: "Bao",
      avatarUrl: null,
      role: "group_member",
      status: "unlinked",
      notes: "",
      inviteEmail: null,
      linkedAt: null,
      createdAt: "",
    },
    {
      id: "jm-mary",
      tripId: "trip",
      userId: null,
      displayName: "Mary",
      avatarUrl: null,
      role: "group_member",
      status: "unlinked",
      notes: "",
      inviteEmail: null,
      linkedAt: null,
      createdAt: "",
    },
    {
      id: "jm-leon",
      tripId: "trip",
      userId: null,
      displayName: "Leon Li",
      avatarUrl: null,
      role: "group_member",
      status: "unlinked",
      notes: "Leon 李旸",
      inviteEmail: null,
      linkedAt: null,
      createdAt: "",
    },
    {
      id: "jm-guoxiang",
      tripId: "trip",
      userId: null,
      displayName: "Guoxiang Chen",
      avatarUrl: null,
      role: "group_member",
      status: "unlinked",
      notes: "祥哥",
      inviteEmail: null,
      linkedAt: null,
      createdAt: "",
    },
    {
      id: "jm-qizhi",
      tripId: "trip",
      userId: null,
      displayName: "Qizhi Chen",
      avatarUrl: null,
      role: "group_member",
      status: "unlinked",
      notes: "",
      inviteEmail: null,
      linkedAt: null,
      createdAt: "",
    },
    {
      id: "jm-tx",
      tripId: "trip",
      userId: null,
      displayName: "TX",
      avatarUrl: null,
      role: "group_member",
      status: "unlinked",
      notes: "Tian Xin",
      inviteEmail: null,
      linkedAt: null,
      createdAt: "",
    },
    {
      id: "jm-caroline",
      tripId: "trip",
      userId: null,
      displayName: "Caroline",
      avatarUrl: null,
      role: "group_member",
      status: "unlinked",
      notes: "Caroline Li 李芊羽",
      inviteEmail: null,
      linkedAt: null,
      createdAt: "",
    },
  ],
);

if (naturalExpenseDrafts.reservations.length > 0) {
  throw new Error("natural accommodation expense should not create reservation drafts");
}

const naturalExpense = naturalExpenseDrafts.expenses[0];
if (!naturalExpense) {
  throw new Error("natural accommodation expense should parse as expense");
}
if (
  naturalExpense.original_amount !== 19395.79 ||
  naturalExpense.original_currency !== "CNY" ||
  naturalExpense.expense_date !== "2026-07-09" ||
  naturalExpense.end_date !== "2026-07-13"
) {
  throw new Error("natural accommodation expense fields mismatch");
}
if (!naturalExpense.participant_member_ids.includes("jm-leon")) {
  throw new Error("natural accommodation expense should match Yang Li to Leon Li");
}
if (!naturalExpense.participant_member_ids.includes("jm-caroline")) {
  throw new Error("natural accommodation expense should match Qianyu Li to Caroline");
}

console.log(`PASS planner import local parser fixtures: ${cases.length}/${cases.length}`);

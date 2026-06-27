"use strict";
var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q, _r, _s, _t, _u, _v, _w, _x, _y, _z, _0, _1, _2, _3, _4, _5, _6, _7, _8, _9, _10, _11, _12, _13, _14, _15, _16, _17, _18, _19, _20, _21, _22, _23, _24;
Object.defineProperty(exports, "__esModule", { value: true });
const planner_import_local_1 = require("../src/lib/planner-import-local");
const planner_import_1 = require("../src/lib/planner-import");
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
const naturalAccommodationExpenseInput = "Bao paid 19,395.79 CNY for Golden Circle House with Hot Tub in Reykholt, Iceland. We stayed from 9 Jul to 13 Jul 2026. Split equally among Bao, Mary, Yang Li, Guoxiang Chen, Qizhi Chen, Xin Tian and Qianyu Li.";
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
const cases = [
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
function assertCase(testCase) {
    var _a;
    const result = (0, planner_import_local_1.parseLocalItinerary)(testCase.input);
    const reservations = (_a = result === null || result === void 0 ? void 0 : result.reservations) !== null && _a !== void 0 ? _a : [];
    if (reservations.length !== testCase.expected.length) {
        throw new Error(`${testCase.name}: expected ${testCase.expected.length} reservations, got ${reservations.length}`);
    }
    testCase.expected.forEach((expected, index) => {
        var _a, _b;
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
        if (!((_a = actual.location_name) === null || _a === void 0 ? void 0 : _a.includes(expected.locationIncludes))) {
            throw new Error(`${testCase.name}: reservation ${index + 1} location mismatch`);
        }
        if (expected.participants) {
            const actualParticipants = (_b = actual.participant_names) !== null && _b !== void 0 ? _b : [];
            if (actualParticipants.join("|") !== expected.participants.join("|")) {
                throw new Error(`${testCase.name}: reservation ${index + 1} participants mismatch`);
            }
        }
    });
}
cases.forEach(assertCase);
const carRentalResult = (0, planner_import_local_1.parseLocalItinerary)(carRentalInput);
const carRentalReservation = (_a = carRentalResult === null || carRentalResult === void 0 ? void 0 : carRentalResult.reservations) === null || _a === void 0 ? void 0 : _a[0];
if ((carRentalReservation === null || carRentalReservation === void 0 ? void 0 : carRentalReservation.ends_at) !== "2026-07-24T18:00:00") {
    throw new Error("car rental shorthand date range should parse the return date");
}
if (((_b = carRentalReservation === null || carRentalReservation === void 0 ? void 0 : carRentalReservation.participant_names) !== null && _b !== void 0 ? _b : []).length > 0) {
    throw new Error("car rental without driver should not default to any participant");
}
const multiAccommodationExpenseResult = (0, planner_import_local_1.parseLocalItinerary)(multiAccommodationExpenseInput);
if (((_c = multiAccommodationExpenseResult === null || multiAccommodationExpenseResult === void 0 ? void 0 : multiAccommodationExpenseResult.reservations) !== null && _c !== void 0 ? _c : []).length > 0) {
    throw new Error("multi accommodation expense import should not create reservation drafts");
}
const multiAccommodationExpenses = (_d = multiAccommodationExpenseResult === null || multiAccommodationExpenseResult === void 0 ? void 0 : multiAccommodationExpenseResult.expenses) !== null && _d !== void 0 ? _d : [];
if (multiAccommodationExpenses.length !== 3) {
    throw new Error(`multi accommodation expense import should create 3 expense drafts, got ${multiAccommodationExpenses.length}`);
}
if (((_e = multiAccommodationExpenses[2]) === null || _e === void 0 ? void 0 : _e.title) !==
    "Accommodation in a beautiful environment accommodation" ||
    ((_f = multiAccommodationExpenses[2]) === null || _f === void 0 ? void 0 : _f.original_amount) !== 17326.31 ||
    ((_g = multiAccommodationExpenses[2]) === null || _g === void 0 ? void 0 : _g.original_currency) !== "CNY") {
    throw new Error("multi accommodation expense import should parse the latest expense fields");
}
if (((_h = multiAccommodationExpenses[1]) === null || _h === void 0 ? void 0 : _h.title) !== "Haukaberg House accommodation" ||
    ((_j = multiAccommodationExpenses[1]) === null || _j === void 0 ? void 0 : _j.original_amount) !== null ||
    ((_k = multiAccommodationExpenses[1]) === null || _k === void 0 ? void 0 : _k.needs_review) !== true) {
    throw new Error("price unavailable accommodation expense should remain as a review draft");
}
const dailyPlanResult = (0, planner_import_local_1.parseLocalItinerary)(dailyPlanInput);
const dailyPlanEvents = (_l = dailyPlanResult === null || dailyPlanResult === void 0 ? void 0 : dailyPlanResult.events) !== null && _l !== void 0 ? _l : [];
if (dailyPlanEvents.length !== 10) {
    throw new Error(`daily plan import should create 10 event drafts, got ${dailyPlanEvents.length}`);
}
if (((_m = dailyPlanEvents[0]) === null || _m === void 0 ? void 0 : _m.day_date) !== "2026-07-08" ||
    ((_o = dailyPlanEvents[0]) === null || _o === void 0 ? void 0 : _o.day_title) !== "抵达冰岛" ||
    ((_p = dailyPlanEvents[0]) === null || _p === void 0 ? void 0 : _p.planned_start) !== "2026-07-08T15:35:00" ||
    ((_q = dailyPlanEvents[0]) === null || _q === void 0 ? void 0 : _q.event_type) !== "flight" ||
    !((_s = (_r = dailyPlanEvents[0]) === null || _r === void 0 ? void 0 : _r.participant_names) === null || _s === void 0 ? void 0 : _s.includes("Bao")) ||
    !((_u = (_t = dailyPlanEvents[0]) === null || _t === void 0 ? void 0 : _t.participant_names) === null || _u === void 0 ? void 0 : _u.includes("Mary"))) {
    throw new Error("daily plan first arrival event fields mismatch");
}
if (((_v = dailyPlanEvents[2]) === null || _v === void 0 ? void 0 : _v.event_type) !== "car" ||
    !((_x = (_w = dailyPlanEvents[2]) === null || _w === void 0 ? void 0 : _w.participant_names) === null || _x === void 0 ? void 0 : _x.includes("Bao"))) {
    throw new Error("daily plan car rental event should preserve driver as participant");
}
if (((_y = dailyPlanEvents[3]) === null || _y === void 0 ? void 0 : _y.event_type) !== "shopping") {
    throw new Error("daily plan grocery event should be classified as shopping");
}
if (!((_0 = (_z = dailyPlanEvents[9]) === null || _z === void 0 ? void 0 : _z.day_notes) === null || _0 === void 0 ? void 0 : _0.includes("提前下载离线地图"))) {
    throw new Error("daily plan notes should be attached to event day notes");
}
const dailyPlanWithAddressesResult = (0, planner_import_local_1.parseLocalItinerary)(dailyPlanWithAddressesInput);
const dailyPlanWithAddressesEvents = (_1 = dailyPlanWithAddressesResult === null || dailyPlanWithAddressesResult === void 0 ? void 0 : dailyPlanWithAddressesResult.events) !== null && _1 !== void 0 ? _1 : [];
if (dailyPlanWithAddressesEvents.length !== 11) {
    throw new Error(`daily plan address import should create 11 event drafts, got ${dailyPlanWithAddressesEvents.length}`);
}
[
    ["Seljalandsfoss, 861 Hvolsvöllur, Iceland", 2],
    ["Skógafoss, Skógar, 861, Iceland", 3],
    ["Reynisfjara Beach, 871 Vík, Iceland", 5],
    ["Vík í Mýrdal, 870 Vík, Iceland", 6],
].forEach(([expectedLocation, index]) => {
    var _a;
    const actual = dailyPlanWithAddressesEvents[Number(index)];
    if ((actual === null || actual === void 0 ? void 0 : actual.location_name) !== expectedLocation) {
        throw new Error(`daily plan address event ${Number(index) + 1} location mismatch: ${actual === null || actual === void 0 ? void 0 : actual.location_name}`);
    }
    if (!((_a = actual.source_excerpt) === null || _a === void 0 ? void 0 : _a.includes("地址："))) {
        throw new Error("daily plan address source excerpt should include the address line");
    }
});
const dailyPlanWithParticipantsResult = (0, planner_import_local_1.parseLocalItinerary)(dailyPlanWithParticipantsInput);
const dailyPlanWithParticipantsEvents = (_2 = dailyPlanWithParticipantsResult === null || dailyPlanWithParticipantsResult === void 0 ? void 0 : dailyPlanWithParticipantsResult.events) !== null && _2 !== void 0 ? _2 : [];
if (dailyPlanWithParticipantsEvents.length !== 14) {
    throw new Error(`daily plan participant import should create 14 event drafts, got ${dailyPlanWithParticipantsEvents.length}`);
}
if (((_4 = (_3 = dailyPlanWithParticipantsEvents[0]) === null || _3 === void 0 ? void 0 : _3.participant_names) === null || _4 === void 0 ? void 0 : _4.join("|")) !==
    "Bao|Mary|Yang Li|Guoxiang Chen|Qizhi Chen") {
    throw new Error("daily plan participant line should populate A group participants");
}
if (((_6 = (_5 = dailyPlanWithParticipantsEvents[1]) === null || _5 === void 0 ? void 0 : _5.participant_names) === null || _6 === void 0 ? void 0 : _6.join("|")) !==
    "田欣|Caroline") {
    throw new Error("daily plan participant line should populate B group participants");
}
if (((_7 = dailyPlanWithParticipantsEvents[3]) === null || _7 === void 0 ? void 0 : _7.location_name) !==
    "Ilulissat Airport Car Rental, Ilulissat, Greenland" ||
    !((_9 = (_8 = dailyPlanWithParticipantsEvents[3]) === null || _8 === void 0 ? void 0 : _8.participant_names) === null || _9 === void 0 ? void 0 : _9.includes("Guoxiang Chen"))) {
    throw new Error("daily plan participant/address block should preserve car rental fields");
}
if (((_10 = dailyPlanWithParticipantsEvents[4]) === null || _10 === void 0 ? void 0 : _10.location_name) !==
    "Hotel Arctic, Mittarfimmut B 1128, 3952 Ilulissat, Greenland" ||
    ((_12 = (_11 = dailyPlanWithParticipantsEvents[4]) === null || _11 === void 0 ? void 0 : _11.participant_names) === null || _12 === void 0 ? void 0 : _12.includes("Yang Li"))) {
    throw new Error("daily plan first hotel block should keep only listed participants");
}
if (((_13 = dailyPlanWithParticipantsEvents[5]) === null || _13 === void 0 ? void 0 : _13.location_name) !==
    "HOTEL SØMA Ilulissat, Nuussuattaap Aqq. 2, 3952 Ilulissat, Greenland" ||
    ((_15 = (_14 = dailyPlanWithParticipantsEvents[5]) === null || _14 === void 0 ? void 0 : _14.participant_names) === null || _15 === void 0 ? void 0 : _15.join("|")) !== "Yang Li") {
    throw new Error("daily plan second hotel block should keep Yang Li only");
}
if (((_16 = dailyPlanWithParticipantsEvents[11]) === null || _16 === void 0 ? void 0 : _16.location_name) !==
    "Blue Lagoon Iceland, Norðurljósavegur 9, 240 Grindavík, Iceland" ||
    ((_18 = (_17 = dailyPlanWithParticipantsEvents[11]) === null || _17 === void 0 ? void 0 : _17.participant_names) === null || _18 === void 0 ? void 0 : _18.join("|")) !==
        "田欣|Caroline") {
    throw new Error("daily plan optional Blue Lagoon block should keep B group participants and address");
}
const parsedDrafts = (0, planner_import_1.toPlannerDrafts)((_19 = (0, planner_import_local_1.parseLocalItinerary)(`Hotel stay
Guests: Yang Li, Guoxiang Chen, Qizhi Chen, Bao, Mary
Dates: 2026-07-27 to 2026-07-31
Location: Kuunnguarsuup Qaava 1, 3952 Ilulissat, Greenland
Hotel: Apartment in Ilulissat - by Pilu & Kaali`)) !== null && _19 !== void 0 ? _19 : {}, [], [
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
]);
const unmatchedKnownMembers = (_21 = (_20 = parsedDrafts.reservations[0]) === null || _20 === void 0 ? void 0 : _20.unmatched_participant_names) !== null && _21 !== void 0 ? _21 : [];
if (unmatchedKnownMembers.length > 0) {
    throw new Error(`known journey members should not be unmatched: ${unmatchedKnownMembers.join(", ")}`);
}
const akaDrafts = (0, planner_import_1.toPlannerDrafts)({
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
}, [], [
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
]);
if (((_22 = akaDrafts.reservations[0]) === null || _22 === void 0 ? void 0 : _22.participant_names.join("|")) !== "Tian Xin") {
    throw new Error("AKA participant names should be canonicalized to journey member names");
}
const expenseDrafts = (0, planner_import_1.toPlannerDrafts)((_23 = (0, planner_import_local_1.parseLocalItinerary)(accommodationExpenseInput)) !== null && _23 !== void 0 ? _23 : {}, [], [
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
]);
if (expenseDrafts.reservations.length > 0) {
    throw new Error("accommodation expense should not create a reservation draft");
}
const accommodationExpense = expenseDrafts.expenses[0];
if (!accommodationExpense) {
    throw new Error("accommodation expense should parse as an expense draft");
}
if (accommodationExpense.original_amount !== 4713.28 ||
    accommodationExpense.original_currency !== "CNY" ||
    accommodationExpense.category !== "hotel") {
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
const naturalExpenseDrafts = (0, planner_import_1.toPlannerDrafts)((_24 = (0, planner_import_local_1.parseLocalItinerary)(naturalAccommodationExpenseInput)) !== null && _24 !== void 0 ? _24 : {}, [], [
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
]);
if (naturalExpenseDrafts.reservations.length > 0) {
    throw new Error("natural accommodation expense should not create reservation drafts");
}
const naturalExpense = naturalExpenseDrafts.expenses[0];
if (!naturalExpense) {
    throw new Error("natural accommodation expense should parse as expense");
}
if (naturalExpense.original_amount !== 19395.79 ||
    naturalExpense.original_currency !== "CNY" ||
    naturalExpense.expense_date !== "2026-07-09" ||
    naturalExpense.end_date !== "2026-07-13") {
    throw new Error("natural accommodation expense fields mismatch");
}
if (!naturalExpense.participant_member_ids.includes("jm-leon")) {
    throw new Error("natural accommodation expense should match Yang Li to Leon Li");
}
if (!naturalExpense.participant_member_ids.includes("jm-caroline")) {
    throw new Error("natural accommodation expense should match Qianyu Li to Caroline");
}
console.log(`PASS planner import local parser fixtures: ${cases.length}/${cases.length}`);

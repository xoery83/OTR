"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.toPlannerDrafts = toPlannerDrafts;
exports.addConflictWarnings = addConflictWarnings;
const validReservationTypes = [
    "flight",
    "hotel",
    "car",
    "ferry",
    "tour",
    "restaurant",
    "other",
];
const validEventTypes = [
    "flight",
    "hotel",
    "car",
    "activity",
    "shopping",
    "meal",
    "transport",
    "note",
    "other",
];
const validLedgerCategories = [
    "flight",
    "hotel",
    "car",
    "fuel",
    "food",
    "ticket",
    "shopping",
    "transport",
    "insurance",
    "other",
];
function normalizeName(value) {
    return value.trim().toLowerCase().replace(/\s+/g, " ");
}
function buildMemberLookup(members) {
    return new Map(members.map((member) => [normalizeName(member.name), member]));
}
const commonJourneyMemberAliases = {
    "leon li": ["yang li", "li yang", "李旸"],
    "caroline": ["qianyu li", "li qianyu", "caroline li", "李芊羽", "李千羽"],
    "tx": ["tian xin", "xin tian", "田欣"],
    "tian xin": ["tx", "xin tian", "田欣"],
};
function aliasVariants(value) {
    const trimmed = value.trim();
    if (!trimmed)
        return [];
    const parts = trimmed.split(/\s+/).filter(Boolean);
    return [
        trimmed,
        ...(parts.length === 2 ? [[...parts].reverse().join(" ")] : []),
    ];
}
function journeyMemberAliases(member) {
    var _a, _b;
    const displayParts = member.displayName.split(/\s+/).filter(Boolean);
    const noteAliases = ((_a = member.notes) !== null && _a !== void 0 ? _a : "")
        .split(/[,，、/;]/)
        .flatMap(aliasVariants);
    const aliases = [
        member.displayName,
        ...displayParts,
        ...(displayParts.length === 2 ? [[...displayParts].reverse().join(" ")] : []),
        ...noteAliases,
        ...((_b = commonJourneyMemberAliases[normalizeName(member.displayName)]) !== null && _b !== void 0 ? _b : []),
    ].filter(Boolean);
    return [...new Set(aliases)];
}
function buildKnownJourneyMemberLookup(journeyMembers) {
    const lookup = new Set();
    journeyMembers.forEach((member) => {
        journeyMemberAliases(member).forEach((alias) => {
            lookup.add(normalizeName(alias));
        });
    });
    return lookup;
}
function buildJourneyMemberAliasLookup(journeyMembers) {
    const lookup = new Map();
    journeyMembers.forEach((member) => {
        journeyMemberAliases(member).forEach((alias) => {
            lookup.set(normalizeName(alias), member);
        });
    });
    return lookup;
}
function toPlannerDrafts(aiResponse, members, journeyMembers = []) {
    var _a, _b, _c, _d;
    const memberLookup = buildMemberLookup(members);
    const knownJourneyMemberLookup = buildKnownJourneyMemberLookup(journeyMembers);
    const journeyMemberAliasLookup = buildJourneyMemberAliasLookup(journeyMembers);
    const isKnownParticipant = (name) => memberLookup.has(normalizeName(name)) ||
        knownJourneyMemberLookup.has(normalizeName(name));
    const canonicalParticipantName = (name) => { var _a, _b; return (_b = (_a = journeyMemberAliasLookup.get(normalizeName(name))) === null || _a === void 0 ? void 0 : _a.displayName) !== null && _b !== void 0 ? _b : name.trim(); };
    const participantUserId = (name) => {
        var _a, _b, _c, _d;
        return (_d = (_b = (_a = memberLookup.get(normalizeName(name))) === null || _a === void 0 ? void 0 : _a.userId) !== null && _b !== void 0 ? _b : (_c = journeyMemberAliasLookup.get(normalizeName(name))) === null || _c === void 0 ? void 0 : _c.userId) !== null && _d !== void 0 ? _d : null;
    };
    const participantMemberId = (name) => { var _a, _b; return (_b = (_a = journeyMemberAliasLookup.get(normalizeName(name))) === null || _a === void 0 ? void 0 : _a.id) !== null && _b !== void 0 ? _b : null; };
    const categoryFor = (value) => {
        const normalized = normalizeName(value !== null && value !== void 0 ? value : "");
        if (/accommodation|hotel|住宿|酒店/.test(normalized))
            return "hotel";
        if (validLedgerCategories.includes(normalized)) {
            return normalized;
        }
        return "other";
    };
    return {
        events: ((_a = aiResponse.events) !== null && _a !== void 0 ? _a : []).map((event, index) => {
            var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q, _r;
            const participantNames = [
                ...new Set(((_a = event.participant_names) !== null && _a !== void 0 ? _a : []).map(canonicalParticipantName).filter(Boolean)),
            ];
            const matched = participantNames
                .map(participantUserId)
                .filter((userId) => Boolean(userId));
            const unmatched = participantNames.filter((name) => !isKnownParticipant(name));
            const eventType = validEventTypes.includes((_b = event.event_type) !== null && _b !== void 0 ? _b : "other")
                ? ((_c = event.event_type) !== null && _c !== void 0 ? _c : "other")
                : "other";
            return {
                clientId: crypto.randomUUID(),
                day_date: event.day_date || null,
                day_title: ((_d = event.day_title) === null || _d === void 0 ? void 0 : _d.trim()) || null,
                day_notes: ((_e = event.day_notes) === null || _e === void 0 ? void 0 : _e.trim()) || null,
                title: ((_f = event.title) === null || _f === void 0 ? void 0 : _f.trim()) || `Imported event ${index + 1}`,
                description: ((_g = event.description) === null || _g === void 0 ? void 0 : _g.trim()) || null,
                event_type: eventType,
                location_name: ((_h = event.location_name) === null || _h === void 0 ? void 0 : _h.trim()) || null,
                planned_start: event.planned_start || null,
                planned_end: event.planned_end || null,
                participant_names: participantNames,
                matched_participant_user_ids: [...new Set(matched)],
                unmatched_participant_names: unmatched,
                confidence: (_j = event.confidence) !== null && _j !== void 0 ? _j : null,
                date_confidence: (_k = event.date_confidence) !== null && _k !== void 0 ? _k : null,
                time_confidence: (_l = event.time_confidence) !== null && _l !== void 0 ? _l : null,
                participants_confidence: (_m = event.participants_confidence) !== null && _m !== void 0 ? _m : null,
                location_confidence: (_o = event.location_confidence) !== null && _o !== void 0 ? _o : null,
                is_estimated_time: (_p = event.is_estimated_time) !== null && _p !== void 0 ? _p : false,
                needs_review: (_q = event.needs_review) !== null && _q !== void 0 ? _q : true,
                source_excerpt: ((_r = event.source_excerpt) === null || _r === void 0 ? void 0 : _r.trim()) || null,
                warnings: [],
                importAnyway: false,
                participantMode: matched.length > 0 ? "detected" : "everyone",
            };
        }),
        reservations: ((_b = aiResponse.reservations) !== null && _b !== void 0 ? _b : []).map((reservation, index) => {
            var _a, _b, _c, _d, _e, _f;
            const reservationType = validReservationTypes.includes(reservation.reservation_type)
                ? reservation.reservation_type
                : "other";
            const participantNames = [
                ...new Set(((_a = reservation.participant_names) !== null && _a !== void 0 ? _a : [])
                    .map(canonicalParticipantName)
                    .filter(Boolean)),
            ];
            const matched = participantNames
                .map(participantUserId)
                .filter((userId) => Boolean(userId));
            const unmatched = participantNames.filter((name) => !isKnownParticipant(name));
            return {
                clientId: crypto.randomUUID(),
                reservation_type: reservationType,
                title: ((_b = reservation.title) === null || _b === void 0 ? void 0 : _b.trim()) || `Imported reservation ${index + 1}`,
                day_date: reservation.day_date || null,
                location_name: ((_c = reservation.location_name) === null || _c === void 0 ? void 0 : _c.trim()) || null,
                starts_at: reservation.starts_at || null,
                ends_at: reservation.ends_at || null,
                participant_names: participantNames,
                matched_participant_user_ids: [...new Set(matched)],
                unmatched_participant_names: unmatched,
                source_excerpt: ((_d = reservation.source_excerpt) === null || _d === void 0 ? void 0 : _d.trim()) || null,
                confidence: (_e = reservation.confidence) !== null && _e !== void 0 ? _e : null,
                needs_review: (_f = reservation.needs_review) !== null && _f !== void 0 ? _f : true,
            };
        }),
        expenses: ((_c = aiResponse.expenses) !== null && _c !== void 0 ? _c : []).map((expense, index) => {
            var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l;
            const participantNames = [
                ...new Set(((_a = expense.participant_names) !== null && _a !== void 0 ? _a : [])
                    .map(canonicalParticipantName)
                    .filter(Boolean)),
            ];
            const participantMemberIds = participantNames
                .map(participantMemberId)
                .filter((memberId) => Boolean(memberId));
            const payerName = expense.payer_name
                ? canonicalParticipantName(expense.payer_name)
                : null;
            const payerMemberId = payerName ? participantMemberId(payerName) : null;
            const unmatched = participantNames.filter((name) => !participantMemberId(name));
            return {
                clientId: crypto.randomUUID(),
                title: ((_b = expense.title) === null || _b === void 0 ? void 0 : _b.trim()) || `Imported expense ${index + 1}`,
                category: categoryFor(expense.category),
                accounting_mode: (_c = expense.accounting_mode) !== null && _c !== void 0 ? _c : "shared",
                expense_date: expense.expense_date || expense.start_date || null,
                start_date: expense.start_date || expense.expense_date || null,
                end_date: expense.end_date || expense.start_date || expense.expense_date || null,
                original_amount: (_d = expense.original_amount) !== null && _d !== void 0 ? _d : null,
                original_currency: ((_e = expense.original_currency) === null || _e === void 0 ? void 0 : _e.trim().toUpperCase()) || "NZD",
                payer_name: payerName,
                payer_member_id: payerMemberId,
                participant_names: participantNames,
                participant_member_ids: [...new Set(participantMemberIds)],
                unmatched_participant_names: unmatched,
                address_text: ((_f = expense.address_text) === null || _f === void 0 ? void 0 : _f.trim()) || null,
                linked_stay_title: ((_g = expense.linked_stay_title) === null || _g === void 0 ? void 0 : _g.trim()) || null,
                linked_stay_location: ((_h = expense.linked_stay_location) === null || _h === void 0 ? void 0 : _h.trim()) || null,
                linked_stay_start_date: expense.linked_stay_start_date || expense.start_date || null,
                linked_stay_end_date: expense.linked_stay_end_date || expense.end_date || null,
                source_excerpt: ((_j = expense.source_excerpt) === null || _j === void 0 ? void 0 : _j.trim()) || null,
                confidence: (_k = expense.confidence) !== null && _k !== void 0 ? _k : null,
                needs_review: (_l = expense.needs_review) !== null && _l !== void 0 ? _l : (!expense.original_amount ||
                    !payerMemberId ||
                    participantMemberIds.length === 0),
            };
        }),
        warnings: (_d = aiResponse.warnings) !== null && _d !== void 0 ? _d : [],
    };
}
function parseTime(value) {
    if (!value)
        return null;
    const time = new Date(value).getTime();
    return Number.isNaN(time) ? null : time;
}
function getEndTime(start, end) {
    if (!start)
        return null;
    if (end && end > start)
        return end;
    return start + 60 * 60 * 1000;
}
function overlaps(firstStartValue, firstEndValue, secondStartValue, secondEndValue) {
    const firstStart = parseTime(firstStartValue);
    const secondStart = parseTime(secondStartValue);
    if (!firstStart || !secondStart)
        return false;
    const firstEnd = getEndTime(firstStart, parseTime(firstEndValue));
    const secondEnd = getEndTime(secondStart, parseTime(secondEndValue));
    if (!firstEnd || !secondEnd)
        return false;
    return firstStart < secondEnd && secondStart < firstEnd;
}
function sameDate(first, second) {
    return Boolean(first && second && first.slice(0, 10) === second.slice(0, 10));
}
function similarText(first, second) {
    if (!first || !second)
        return false;
    const a = normalizeName(first);
    const b = normalizeName(second);
    return a.includes(b) || b.includes(a);
}
function withinMinutes(first, second, minutes) {
    const firstTime = parseTime(first);
    const secondTime = parseTime(second);
    if (!firstTime || !secondTime)
        return false;
    return Math.abs(firstTime - secondTime) <= minutes * 60 * 1000;
}
function addConflictWarnings(drafts, existingEvents) {
    return drafts.map((draft) => {
        const warnings = [...draft.warnings];
        if (!draft.planned_start) {
            warnings.push({
                type: "missing_info",
                severity: "warning",
                message: "Date or start time is missing.",
                conflicting_event_id: null,
                conflicting_event_title: null,
            });
        }
        if (draft.unmatched_participant_names.length > 0) {
            warnings.push({
                type: "missing_info",
                severity: "warning",
                message: `Unknown participant: ${draft.unmatched_participant_names.join(", ")}.`,
                conflicting_event_id: null,
                conflicting_event_title: null,
            });
        }
        if (draft.participant_names.length === 0) {
            warnings.push({
                type: "missing_info",
                severity: "info",
                message: "No participants detected. Review the participant option before importing.",
                conflicting_event_id: null,
                conflicting_event_title: null,
            });
        }
        if (draft.planned_start && !/[zZ]|[+-]\d{2}:\d{2}$/.test(draft.planned_start)) {
            warnings.push({
                type: "timezone_uncertain",
                severity: "info",
                message: "Timezone was not explicit in the parsed start time.",
                conflicting_event_id: null,
                conflicting_event_title: null,
            });
        }
        existingEvents.forEach((existing) => {
            const hasOverlap = overlaps(draft.planned_start, draft.planned_end, existing.plannedStart, existing.plannedEnd);
            const sharedParticipants = existing.participants
                .map((participant) => participant.userId)
                .filter((userId) => draft.matched_participant_user_ids.includes(userId));
            if (hasOverlap && sharedParticipants.length > 0) {
                warnings.push({
                    type: "participant_conflict",
                    severity: "critical",
                    message: `Participant conflict with ${existing.title}.`,
                    conflicting_event_id: existing.id,
                    conflicting_event_title: existing.title,
                });
            }
            else if (hasOverlap) {
                warnings.push({
                    type: "time_overlap",
                    severity: "warning",
                    message: `Time overlaps with ${existing.title}.`,
                    conflicting_event_id: existing.id,
                    conflicting_event_title: existing.title,
                });
            }
            if (sameDate(draft.planned_start, existing.plannedStart) &&
                withinMinutes(draft.planned_start, existing.plannedStart, 60) &&
                (similarText(draft.title, existing.title) ||
                    similarText(draft.location_name, existing.locationName))) {
                warnings.push({
                    type: "duplicate",
                    severity: "warning",
                    message: `Possible duplicate of ${existing.title}.`,
                    conflicting_event_id: existing.id,
                    conflicting_event_title: existing.title,
                });
            }
            if (existing.eventType === "flight" &&
                draft.planned_start &&
                existing.plannedEnd &&
                parseTime(existing.plannedEnd) > parseTime(draft.planned_start) &&
                ["hotel", "car", "activity", "meal", "transport"].includes(draft.event_type)) {
                warnings.push({
                    type: "time_overlap",
                    severity: "warning",
                    message: `${draft.event_type} starts before ${existing.title} ends.`,
                    conflicting_event_id: existing.id,
                    conflicting_event_title: existing.title,
                });
            }
        });
        return Object.assign(Object.assign({}, draft), { warnings });
    });
}

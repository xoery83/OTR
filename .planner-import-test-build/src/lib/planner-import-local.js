"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseLocalItinerary = parseLocalItinerary;
function compactWhitespace(value) {
    return value === null || value === void 0 ? void 0 : value.replace(/\s+/g, " ").trim();
}
function fieldValue(text, labels) {
    const labelPattern = labels.map((label) => label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
    const match = text.match(new RegExp(`(?:^|\\n)\\s*(?:${labelPattern})\\s*[:：]\\s*([^\\n]+)`, "i"));
    return compactWhitespace(match === null || match === void 0 ? void 0 : match[1]);
}
function multilineFieldValue(text, labels, stopLabels) {
    const labelPattern = labels.map((label) => label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
    const stopPattern = stopLabels.map((label) => label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
    const match = text.match(new RegExp(`(?:^|\\n)\\s*(?:${labelPattern})\\s*[:：]\\s*([\\s\\S]*?)(?=\\n\\s*(?:${stopPattern})\\s*[:：]|$)`, "i"));
    return compactWhitespace(match === null || match === void 0 ? void 0 : match[1]);
}
function rawMultilineFieldValue(text, labels, stopLabels) {
    var _a;
    const labelPattern = labels.map((label) => label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
    const stopPattern = stopLabels.map((label) => label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
    const match = text.match(new RegExp(`(?:^|\\n)\\s*(?:${labelPattern})\\s*[:：]\\s*([\\s\\S]*?)(?=\\n\\s*(?:${stopPattern})\\s*[:：]|$)`, "i"));
    return (_a = match === null || match === void 0 ? void 0 : match[1]) === null || _a === void 0 ? void 0 : _a.trim();
}
function splitNames(value) {
    if (!value)
        return [];
    const lines = value
        .split(/\n+/)
        .map((line) => line.trim())
        .filter(Boolean);
    if (lines.length > 1 && lines.every((line) => !/[，,、/]/.test(line))) {
        return lines;
    }
    return (value !== null && value !== void 0 ? value : "")
        .split(/\s*(?:,|，|、|\/|和|及|与|\band\b)\s*/gi)
        .map((name) => name.trim().replace(/\.$/, ""))
        .filter(Boolean);
}
function emptyParsed(warnings = []) {
    return {
        days: [],
        reservations: [],
        events: [],
        expenses: [],
        warnings,
    };
}
function splitImportBlocks(rawText) {
    const normalized = rawText.replace(/\r\n/g, "\n").trim();
    if (!normalized)
        return [];
    const paragraphBlocks = normalized
        .split(/\n\s*\n+/)
        .map((text, index) => ({
        id: `paragraph-${index}`,
        text: text.trim(),
    }))
        .filter((block) => block.text.length > 0);
    if (paragraphBlocks.length > 1) {
        return paragraphBlocks;
    }
    const lineBlocks = [];
    let currentLines = [];
    normalized.split("\n").forEach((line) => {
        const trimmed = line.trim();
        const startsHotelBlock = /^hotel stay\b/i.test(trimmed);
        if (startsHotelBlock && currentLines.length > 0) {
            lineBlocks.push({
                id: `line-${lineBlocks.length}`,
                text: currentLines.join("\n").trim(),
            });
            currentLines = [];
        }
        currentLines.push(line);
    });
    if (currentLines.length > 0) {
        lineBlocks.push({
            id: `line-${lineBlocks.length}`,
            text: currentLines.join("\n").trim(),
        });
    }
    return lineBlocks.length > 1 ? lineBlocks : [{ id: "full-text", text: normalized }];
}
function splitAccommodationExpenseBlocks(rawText) {
    const normalized = rawText.replace(/\r\n/g, "\n").trim();
    if (!normalized)
        return [];
    return normalized
        .split(/(?=^\s*(?:accommodation expense|hotel expense|住宿费用|酒店费用|房费)\b)/gim)
        .map((block) => block.trim())
        .filter((block) => /^(accommodation expense|hotel expense|住宿费用|酒店费用|房费)\b/i.test(block));
}
function uniqueDaysFromReservations(reservations, expenses = [], events = []) {
    const days = new Map();
    [
        ...reservations.map((reservation) => ({
            date: reservation.day_date,
            title: null,
            notes: null,
        })),
        ...expenses.map((expense) => ({
            date: expense.expense_date,
            title: null,
            notes: null,
        })),
        ...events.map((event) => {
            var _a, _b;
            return ({
                date: event.day_date,
                title: (_a = event.day_title) !== null && _a !== void 0 ? _a : null,
                notes: (_b = event.day_notes) !== null && _b !== void 0 ? _b : null,
            });
        }),
    ].forEach((day) => {
        var _a, _b;
        if (!day.date)
            return;
        const existing = days.get(day.date);
        days.set(day.date, {
            date: day.date,
            title: (_a = existing === null || existing === void 0 ? void 0 : existing.title) !== null && _a !== void 0 ? _a : day.title,
            notes: (_b = existing === null || existing === void 0 ? void 0 : existing.notes) !== null && _b !== void 0 ? _b : day.notes,
        });
    });
    return [...days.values()];
}
function parseFlightBlock(blockText) {
    var _a, _b, _c, _d, _e, _f;
    const blockPattern = /(?:([^\n]+)\n)?(\d{4}-\d{2}-\d{2})\s+(\d{1,2})[:：](\d{2})\s*\n\s*(?:flight|航班)\s*([A-Z0-9]{2,}\s*-?\s*\d{2,5})\s*\n\s*([A-Za-z\s.'-]+)\s*\(([A-Z]{3})\)\s*(?:→|->|to|到)\s*([A-Za-z\s.'-]+)\s*\(([A-Z]{3})\)/i;
    const match = blockText.match(blockPattern);
    if (!match)
        return null;
    const date = match[2];
    const hour = (_a = match[3]) === null || _a === void 0 ? void 0 : _a.padStart(2, "0");
    const minute = match[4];
    const flightNumber = (_b = match[5]) === null || _b === void 0 ? void 0 : _b.replace(/\s+/g, "").toUpperCase();
    const originCity = (_c = compactWhitespace(match[6])) !== null && _c !== void 0 ? _c : "";
    const originCode = (_d = match[7]) === null || _d === void 0 ? void 0 : _d.toUpperCase();
    const destinationCity = (_e = compactWhitespace(match[8])) !== null && _e !== void 0 ? _e : "";
    const destinationCode = (_f = match[9]) === null || _f === void 0 ? void 0 : _f.toUpperCase();
    const route = `${originCity} (${originCode}) → ${destinationCity} (${destinationCode})`;
    return {
        reservation_type: "flight",
        title: `Flight ${flightNumber}`,
        day_date: date,
        location_name: route,
        starts_at: `${date}T${hour}:${minute}:00`,
        ends_at: null,
        source_excerpt: match[0],
        confidence: 0.95,
        needs_review: true,
    };
}
function parseFlightBlocks(rawText, blocks) {
    const globalPattern = /(?:([^\n]+)\n)?(\d{4}-\d{2}-\d{2})\s+(\d{1,2})[:：](\d{2})\s*\n\s*(?:flight|航班)\s*([A-Z0-9]{2,}\s*-?\s*\d{2,5})\s*\n\s*([A-Za-z\s.'-]+)\s*\(([A-Z]{3})\)\s*(?:→|->|to|到)\s*([A-Za-z\s.'-]+)\s*\(([A-Z]{3})\)/gi;
    const globalReservations = [...rawText.matchAll(globalPattern)]
        .map((match) => parseFlightBlock(match[0]))
        .filter((reservation) => reservation !== null);
    if (globalReservations.length > 0) {
        return globalReservations;
    }
    return blocks
        .map((block) => parseFlightBlock(block.text))
        .filter((reservation) => reservation !== null);
}
function parseIsoDateRange(text) {
    const match = text.match(/(\d{4}-\d{2}-\d{2})\s*(?:to|至|到|~|-|–|—)\s*(\d{4}-\d{2}-\d{2})/i);
    if (!match)
        return null;
    return { startDate: match[1], endDate: match[2] };
}
function toIsoDate(year, month, day) {
    const date = new Date(Date.UTC(year, month - 1, day));
    if (date.getUTCFullYear() !== year ||
        date.getUTCMonth() !== month - 1 ||
        date.getUTCDate() !== day) {
        return null;
    }
    return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}
function parseLooseDateToken(value, fallbackYear) {
    const token = value.trim().replace(/\s+/g, "");
    const isoMatch = token.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    if (isoMatch) {
        return toIsoDate(Number(isoMatch[1]), Number(isoMatch[2]), Number(isoMatch[3]));
    }
    const separatedMatch = token.match(/^(\d{1,2})(?:[/.月])(\d{1,2})日?$/);
    if (separatedMatch) {
        return toIsoDate(fallbackYear, Number(separatedMatch[1]), Number(separatedMatch[2]));
    }
    const compactMatch = token.match(/^\d{2,4}$/);
    if (!compactMatch)
        return null;
    if (token.length === 2) {
        return toIsoDate(fallbackYear, Number(token[0]), Number(token[1]));
    }
    if (token.length === 3) {
        return toIsoDate(fallbackYear, Number(token[0]), Number(token.slice(1)));
    }
    return toIsoDate(fallbackYear, Number(token.slice(0, 2)), Number(token.slice(2)));
}
function parseLooseDateRange(text) {
    var _a;
    const isoRange = parseIsoDateRange(text);
    if (isoRange)
        return isoRange;
    const fallbackYear = Number((_a = text.match(/\b(20\d{2})\b/)) === null || _a === void 0 ? void 0 : _a[1]) || new Date().getFullYear();
    const tokenPattern = String.raw `(?:\d{4}-\d{1,2}-\d{1,2}|\d{1,2}\s*(?:[/.月])\s*\d{1,2}日?|\d{2,4})`;
    const labeledMatch = text.match(new RegExp(String.raw `(?:跨越时间|租车时间|取还车时间|日期|dates?|时间)\s*[:：]?\s*(${tokenPattern})\s*(?:-|–|—|到|至|~)\s*(${tokenPattern})`, "i"));
    const looseMatch = labeledMatch !== null && labeledMatch !== void 0 ? labeledMatch : text.match(new RegExp(String.raw `\b(${tokenPattern})\s*(?:-|–|—|到|至|~)\s*(${tokenPattern})\b`, "i"));
    if (!looseMatch)
        return null;
    const startDate = parseLooseDateToken(looseMatch[1], fallbackYear);
    const endDate = parseLooseDateToken(looseMatch[2], fallbackYear);
    if (!startDate || !endDate)
        return null;
    return { startDate, endDate };
}
function parseHotelBlock(blockText) {
    var _a, _b;
    if (/(accommodation expense|hotel expense|住宿费用|酒店费用|房费)/i.test(blockText)) {
        return null;
    }
    const range = parseIsoDateRange((_a = fieldValue(blockText, ["Dates", "Date", "日期"])) !== null && _a !== void 0 ? _a : blockText);
    const title = fieldValue(blockText, ["Hotel", "酒店", "住宿", "Accommodation"]);
    const locationName = fieldValue(blockText, ["Location", "Address", "地址", "地点"]);
    const guests = multilineFieldValue(blockText, ["Guests", "Guest", "客人", "入住人"], ["Dates", "Date", "日期", "Location", "Address", "地址", "地点", "Hotel", "酒店", "住宿", "Accommodation", "Platform", "平台", "Provider", "Phone", "电话"]);
    const platform = fieldValue(blockText, ["Platform", "平台", "Provider"]);
    const phone = fieldValue(blockText, ["Phone", "电话"]);
    const looksLikeHotel = /(hotel stay|hotel|住宿|酒店|airbnb|booking|accommodation)/i.test(blockText) ||
        Boolean(title && (range || locationName));
    if (!looksLikeHotel || (!range && !title && !locationName))
        return null;
    const sourceBits = [
        title ? `Hotel: ${title}` : null,
        locationName ? `Location: ${locationName}` : null,
        guests ? `Guests: ${guests}` : null,
        platform ? `Platform: ${platform}` : null,
        phone ? `Phone: ${phone}` : null,
    ].filter(Boolean);
    return {
        reservation_type: "hotel",
        title: title || "Hotel stay",
        day_date: (_b = range === null || range === void 0 ? void 0 : range.startDate) !== null && _b !== void 0 ? _b : null,
        location_name: locationName || null,
        starts_at: range ? `${range.startDate}T15:00:00` : null,
        ends_at: range ? `${range.endDate}T11:00:00` : null,
        participant_names: splitNames(guests),
        source_excerpt: sourceBits.length > 0 ? sourceBits.join("\n") : blockText,
        confidence: 0.95,
        needs_review: false,
    };
}
function parseHotelBlocks(blocks) {
    return blocks
        .map((block) => parseHotelBlock(block.text))
        .filter((reservation) => reservation !== null);
}
function parseCarRentalCompany(blockText) {
    const labeledCompany = fieldValue(blockText, [
        "Company",
        "Rental company",
        "Car rental",
        "Provider",
        "供应商",
        "租车公司",
        "租车",
    ]);
    if (labeledCompany && !/^\d{1,4}\s*(?:-|–|—|到|至|~)/.test(labeledCompany)) {
        return labeledCompany;
    }
    const namedCompany = blockText.match(/([A-Za-z0-9&.' -]*\b(?:car rental|rental car|rent a car|rental cars)\b[A-Za-z0-9&.' -]*)/i);
    if (namedCompany === null || namedCompany === void 0 ? void 0 : namedCompany[1])
        return compactWhitespace(namedCompany[1]);
    const commaCompany = blockText.match(/[，,]\s*([^，,\n]+?)(?:\s*[，,]|\n|$)/);
    if ((commaCompany === null || commaCompany === void 0 ? void 0 : commaCompany[1]) && !/(跨越时间|日期|时间|amount|金额)/i.test(commaCompany[1])) {
        return compactWhitespace(commaCompany[1]);
    }
    return null;
}
function parseCarRentalBlock(blockText) {
    var _a, _b;
    const looksLikeCarRental = /(租车|car rental|rental car|rent a car|取车|还车)/i.test(blockText);
    if (!looksLikeCarRental)
        return null;
    const range = parseLooseDateRange(blockText);
    const company = parseCarRentalCompany(blockText);
    const locationName = (_a = fieldValue(blockText, ["Location", "Address", "Pick-up", "Pickup", "取车地点", "地点", "地址"])) !== null && _a !== void 0 ? _a : company;
    const driver = fieldValue(blockText, ["Driver", "驾驶人", "司机"]);
    const titleBase = company || "Car rental";
    const title = /租车|car rental|rental car|rent a car/i.test(titleBase)
        ? titleBase
        : `${titleBase} 租车`;
    if (!range && !company)
        return null;
    return {
        reservation_type: "car",
        title,
        day_date: (_b = range === null || range === void 0 ? void 0 : range.startDate) !== null && _b !== void 0 ? _b : null,
        location_name: locationName || null,
        starts_at: range ? `${range.startDate}T09:00:00` : null,
        ends_at: range ? `${range.endDate}T18:00:00` : null,
        participant_names: splitNames(driver),
        source_excerpt: blockText,
        confidence: range && company ? 0.92 : 0.78,
        needs_review: true,
    };
}
function parseCarRentalBlocks(rawText, blocks) {
    const fullTextReservation = parseCarRentalBlock(rawText);
    if (fullTextReservation)
        return [fullTextReservation];
    return blocks
        .map((block) => parseCarRentalBlock(block.text))
        .filter((reservation) => reservation !== null);
}
function parseMoney(value) {
    var _a;
    const match = value === null || value === void 0 ? void 0 : value.match(/([0-9]+(?:[,，]\d{3})*(?:\.\d+)?)\s*([A-Z]{3}|RMB|CNY|NZD|AUD|CHF|USD|EUR|ISK|DKK|GBP)?/i);
    if (!match)
        return null;
    return {
        amount: Number(match[1].replace(/[,，]/g, "")),
        currency: ((_a = match[2]) !== null && _a !== void 0 ? _a : "NZD").toUpperCase(),
    };
}
const monthNames = {
    jan: "01",
    january: "01",
    feb: "02",
    february: "02",
    mar: "03",
    march: "03",
    apr: "04",
    april: "04",
    may: "05",
    jun: "06",
    june: "06",
    jul: "07",
    july: "07",
    aug: "08",
    august: "08",
    sep: "09",
    sept: "09",
    september: "09",
    oct: "10",
    october: "10",
    nov: "11",
    november: "11",
    dec: "12",
    december: "12",
};
function parseEnglishDateRange(text) {
    const match = text.match(/(?:stayed\s+)?from\s+(\d{1,2})\s+([A-Za-z]+)\s+(?:to|until|-|–|—)\s+(\d{1,2})\s+([A-Za-z]+)?\s+(\d{4})/i);
    if (!match)
        return null;
    const startDay = match[1].padStart(2, "0");
    const startMonth = monthNames[match[2].toLowerCase()];
    const endDay = match[3].padStart(2, "0");
    const endMonth = monthNames[(match[4] || match[2]).toLowerCase()];
    const year = match[5];
    if (!startMonth || !endMonth)
        return null;
    return {
        startDate: `${year}-${startMonth}-${startDay}`,
        endDate: `${year}-${endMonth}-${endDay}`,
    };
}
function isNaturalAccommodationExpense(text) {
    return (/\b(paid|spent)\b/i.test(text) &&
        /\b(split|shared|equally|among)\b/i.test(text) &&
        /\b(hotel|house|stay|stayed|accommodation|airbnb|booking)\b/i.test(text) &&
        /[0-9]+(?:[,，]\d{3})*(?:\.\d+)?\s*(?:[A-Z]{3}|RMB|CNY|NZD|AUD|CHF|USD|EUR|ISK|DKK|GBP)/i.test(text));
}
function parseNaturalAccommodationExpense(blockText) {
    var _a;
    if (!isNaturalAccommodationExpense(blockText))
        return null;
    const paidMatch = blockText.match(/^\s*([A-Za-z][A-Za-z\s.'-]*?)\s+(?:paid|spent)\s+([0-9]+(?:[,，]\d{3})*(?:\.\d+)?)\s*([A-Z]{3}|RMB|CNY|NZD|AUD|CHF|USD|EUR|ISK|DKK|GBP)\s+for\s+(.+?)(?:\.|\n|$)/i);
    if (!paidMatch)
        return null;
    const payer = compactWhitespace(paidMatch[1]);
    const money = parseMoney(`${paidMatch[2]} ${paidMatch[3]}`);
    const target = compactWhitespace(paidMatch[4]);
    const stayRange = parseEnglishDateRange(blockText);
    const splitMatch = blockText.match(/split\s+(?:equally\s+)?(?:among|with)\s+(.+?)(?:\.|$)/i);
    const splitWith = splitMatch === null || splitMatch === void 0 ? void 0 : splitMatch[1];
    if (!money || !target || !stayRange)
        return null;
    const targetMatch = target.match(/^(.+?)\s+in\s+(.+)$/i);
    const hotel = compactWhitespace((_a = targetMatch === null || targetMatch === void 0 ? void 0 : targetMatch[1]) !== null && _a !== void 0 ? _a : target);
    const location = compactWhitespace(targetMatch === null || targetMatch === void 0 ? void 0 : targetMatch[2]);
    return {
        title: `${hotel} accommodation`,
        category: "Accommodation",
        accounting_mode: "shared",
        expense_date: stayRange.startDate,
        start_date: stayRange.startDate,
        end_date: stayRange.endDate,
        original_amount: money.amount,
        original_currency: money.currency,
        payer_name: payer || null,
        participant_names: splitNames(splitWith),
        address_text: location || null,
        linked_stay_title: hotel,
        linked_stay_location: location || null,
        linked_stay_start_date: stayRange.startDate,
        linked_stay_end_date: stayRange.endDate,
        source_excerpt: blockText,
        confidence: 0.92,
        needs_review: false,
    };
}
function parseExpenseBlock(blockText) {
    var _a, _b, _c, _d, _e, _f;
    const naturalExpense = parseNaturalAccommodationExpense(blockText);
    if (naturalExpense)
        return naturalExpense;
    const looksLikeAccommodationExpense = /(accommodation expense|hotel expense|住宿费用|酒店费用|房费)/i.test(blockText);
    if (!looksLikeAccommodationExpense)
        return null;
    const checkIn = fieldValue(blockText, ["Check-in", "Check in", "入住", "开始日期"]);
    const checkOut = fieldValue(blockText, ["Check-out", "Check out", "退房", "结束日期"]);
    const hotel = multilineFieldValue(blockText, ["Hotel", "酒店", "住宿"], ["Address", "地址", "Amount", "金额", "Paid by", "付款人", "Split with", "分摊人", "Category", "分类", "Linked stay", "关联住宿"]);
    const address = multilineFieldValue(blockText, ["Address", "地址"], ["Amount", "金额", "Paid by", "付款人", "Split with", "分摊人", "Category", "分类", "Linked stay", "关联住宿"]);
    const amountText = fieldValue(blockText, ["Amount", "金额", "费用"]);
    const money = parseMoney(amountText);
    const amountUnavailable = /\b(price unavailable|unavailable|unknown|n\/a|na|tbd|待定|未知|无价格)\b/i.test(amountText !== null && amountText !== void 0 ? amountText : "");
    const payer = fieldValue(blockText, ["Paid by", "付款人", "支付人"]);
    const splitWith = rawMultilineFieldValue(blockText, ["Split with", "分摊人", "Split", "分摊"], ["Category", "分类", "Linked stay", "关联住宿"]);
    const category = fieldValue(blockText, ["Category", "分类"]);
    const linkedRange = parseIsoDateRange((_a = fieldValue(blockText, ["Linked stay", "关联住宿"])) !== null && _a !== void 0 ? _a : "");
    if ((!money && !amountUnavailable) || !checkIn)
        return null;
    return {
        title: hotel ? `${hotel} accommodation` : "Accommodation expense",
        category: category || "Accommodation",
        accounting_mode: "shared",
        expense_date: checkIn,
        start_date: checkIn,
        end_date: checkOut || checkIn,
        original_amount: (_b = money === null || money === void 0 ? void 0 : money.amount) !== null && _b !== void 0 ? _b : null,
        original_currency: (_c = money === null || money === void 0 ? void 0 : money.currency) !== null && _c !== void 0 ? _c : "CNY",
        payer_name: payer || null,
        participant_names: splitNames(splitWith),
        address_text: address || null,
        linked_stay_title: hotel || null,
        linked_stay_location: address || null,
        linked_stay_start_date: (_d = linkedRange === null || linkedRange === void 0 ? void 0 : linkedRange.startDate) !== null && _d !== void 0 ? _d : checkIn,
        linked_stay_end_date: (_f = (_e = linkedRange === null || linkedRange === void 0 ? void 0 : linkedRange.endDate) !== null && _e !== void 0 ? _e : checkOut) !== null && _f !== void 0 ? _f : checkIn,
        source_excerpt: blockText,
        confidence: 0.95,
        needs_review: !money || amountUnavailable,
    };
}
function parseExpenseBlocks(rawText, blocks) {
    const accommodationExpenseBlocks = splitAccommodationExpenseBlocks(rawText);
    if (accommodationExpenseBlocks.length > 0) {
        return accommodationExpenseBlocks
            .map((block) => parseExpenseBlock(block))
            .filter((expense) => expense !== null);
    }
    const fullTextExpense = parseExpenseBlock(rawText);
    if (fullTextExpense)
        return [fullTextExpense];
    return blocks
        .map((block) => parseExpenseBlock(block.text))
        .filter((expense) => expense !== null);
}
function parseReservationBlocks(rawText, blocks) {
    const reservations = [
        ...parseFlightBlocks(rawText, blocks),
        ...parseCarRentalBlocks(rawText, blocks),
        ...parseHotelBlocks(blocks),
    ];
    const seen = new Set();
    return reservations.filter((reservation) => {
        const key = [
            reservation.reservation_type,
            reservation.title,
            reservation.starts_at,
            reservation.location_name,
        ].join("|");
        if (seen.has(key))
            return false;
        seen.add(key);
        return true;
    });
}
function dailyPlanEntries(scheduleText) {
    const entries = [];
    let current = null;
    function flushCurrent() {
        if (!current)
            return;
        const extraText = current.extraLines.join("\n");
        const address = multilineFieldValue(extraText, ["地址", "Address"], [
            "地址",
            "Address",
            "参与人",
            "Participants",
            "Guests",
            "注意事项",
        ]);
        const participants = splitNames(multilineFieldValue(extraText, ["参与人", "Participants", "Guests"], [
            "地址",
            "Address",
            "参与人",
            "Participants",
            "Guests",
            "注意事项",
        ]));
        entries.push({
            hour: current.hour,
            minute: current.minute,
            content: current.content,
            address: address !== null && address !== void 0 ? address : null,
            participants,
            sourceExcerpt: [current.content, ...current.extraLines].join("\n").trim(),
        });
        current = null;
    }
    scheduleText.split("\n").forEach((line) => {
        const match = line.match(/^\s*(\d{1,2})[:：](\d{2})\s+(.+)$/);
        if (match) {
            flushCurrent();
            current = {
                hour: match[1],
                minute: match[2],
                content: match[3],
                extraLines: [],
            };
            return;
        }
        if (current && line.trim()) {
            current.extraLines.push(line.trim());
        }
    });
    flushCurrent();
    return entries;
}
function parseDailyPlan(rawText) {
    var _a;
    const normalized = rawText.replace(/\r\n/g, "\n").trim();
    const headerMatch = normalized.match(/^#?\s*(?:day|d)\s*\d+\s*[｜|]\s*(\d{4}-\d{2}-\d{2})\s*[｜|]\s*(.+)$/im);
    if (!headerMatch)
        return [];
    const dayDate = headerMatch[1];
    const dayTitle = (_a = compactWhitespace(headerMatch[2])) !== null && _a !== void 0 ? _a : null;
    const notesMatch = normalized.match(/(?:^|\n)\s*注意事项\s*[:：]\s*([\s\S]*)$/i);
    const dayNotes = notesMatch
        ? notesMatch[1]
            .split("\n")
            .map((line) => line.trim().replace(/^[-*]\s*/, ""))
            .filter(Boolean)
            .join("\n")
        : null;
    const scheduleText = notesMatch
        ? normalized.slice(0, notesMatch.index).trim()
        : normalized;
    const eventLines = dailyPlanEntries(scheduleText);
    return eventLines.map((entry) => {
        var _a, _b, _c, _d, _e, _f, _g, _h;
        const hour = entry.hour.padStart(2, "0");
        const minute = entry.minute;
        const content = (_b = compactWhitespace((_a = entry.content) === null || _a === void 0 ? void 0 : _a.replace(/[。.]$/, ""))) !== null && _b !== void 0 ? _b : "";
        const participantMatch = content.match(/^(.+?)\s*(?:抵达|到达|arrive|arrives)/i);
        const driverMatch = content.match(/驾驶人\s*[:：]\s*([^，。,.;]+)/i);
        const participantNames = [
            ...splitNames(participantMatch === null || participantMatch === void 0 ? void 0 : participantMatch[1]),
            ...splitNames(driverMatch === null || driverMatch === void 0 ? void 0 : driverMatch[1]),
            ...entry.participants,
        ];
        const locationMatch = (_e = (_d = (_c = content.match(/(?:抵达|到达)\s*([^，。,.;]+)/i)) !== null && _c !== void 0 ? _c : content.match(/在\s+(.+?)\s+的\s+/i)) !== null && _d !== void 0 ? _d : content.match(/前往\s+(.+?)(?:采购|补充|住宿|接|。|$)/i)) !== null && _e !== void 0 ? _e : content.match(/选择\s+(.+?)(?:\s+或|。|$)/i);
        const locationName = (_h = (_f = entry.address) !== null && _f !== void 0 ? _f : compactWhitespace((_g = locationMatch === null || locationMatch === void 0 ? void 0 : locationMatch[1]) === null || _g === void 0 ? void 0 : _g.replace(/[（）]/g, " "))) !== null && _h !== void 0 ? _h : null;
        let eventType = "activity";
        if (/(取车|租车|car rental|驾驶人)/i.test(content))
            eventType = "car";
        else if (/(采购|超市|costco|bónus|bonus|购物|日用品)/i.test(content))
            eventType = "shopping";
        else if (/(晚餐|午餐|早餐|餐厅|food|restaurant)/i.test(content))
            eventType = "meal";
        else if (/(前往|接|出发|离开|route|导航)/i.test(content))
            eventType = "transport";
        else if (/(入住|住宿|check.?in|整理行李)/i.test(content))
            eventType = "hotel";
        else if (/(flight|航班)/i.test(content) ||
            /(?:抵达|到达|arrive|arrives).*(?:机场|airport|\([A-Z]{3}\))/i.test(content) ||
            /\b[A-Z0-9]{2,3}\s?-?\s?\d{2,5}\b/.test(content)) {
            eventType = "flight";
        }
        return {
            day_date: dayDate,
            day_title: dayTitle,
            day_notes: dayNotes,
            title: content,
            description: null,
            event_type: eventType,
            location_name: locationName,
            planned_start: `${dayDate}T${hour}:${minute}:00`,
            planned_end: null,
            participant_names: [...new Set(participantNames)],
            confidence: 0.88,
            date_confidence: 0.98,
            time_confidence: 0.98,
            participants_confidence: participantNames.length > 0 ? 0.82 : null,
            location_confidence: locationName ? 0.75 : null,
            is_estimated_time: false,
            needs_review: false,
            source_excerpt: entry.sourceExcerpt,
        };
    });
}
function parseLocalItinerary(rawText) {
    const blocks = splitImportBlocks(rawText);
    const events = parseDailyPlan(rawText);
    const expenses = parseExpenseBlocks(rawText, blocks);
    const isExpenseOnlyInput = /^(accommodation expense|hotel expense|住宿费用|酒店费用|房费)\b/i.test(rawText.trim()) || isNaturalAccommodationExpense(rawText);
    const reservations = isExpenseOnlyInput ? [] : parseReservationBlocks(rawText, blocks);
    if (reservations.length === 0 && expenses.length === 0 && events.length === 0)
        return null;
    return Object.assign(Object.assign({}, emptyParsed()), { days: uniqueDaysFromReservations(reservations, expenses, events), events,
        reservations,
        expenses, warnings: reservations.some((reservation) => reservation.reservation_type === "flight")
            ? ["Flight arrival times are unknown; please review before importing."]
            : [] });
}

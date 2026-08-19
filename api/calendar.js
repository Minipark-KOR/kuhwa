// /api/calendar.js
// Vercel Serverless Function
// 한국구화학교(NEIS) 학사일정을 iCalendar(.ics) 형식으로 반환합니다.
// 구글 캘린더 등에서 "URL로 캘린더 추가" 기능으로 구독하면 자동으로 동기화됩니다.

const ATPT_OFCDC_SC_CODE = "B10"; // 서울특별시교육청
const SD_SCHUL_CODE = "7010473"; // 한국구화학교
const PAGE_SIZE = 1000;

async function fetchYearRows(apiKey, year) {
  const rows = [];
  let pIndex = 1;
  let totalCount = null;

  while (totalCount === null || rows.length < totalCount) {
    const params = new URLSearchParams({
      KEY: apiKey,
      Type: "json",
      pIndex: String(pIndex),
      pSize: String(PAGE_SIZE),
      ATPT_OFCDC_SC_CODE,
      SD_SCHUL_CODE,
      AA_FROM_YMD: `${year}0101`,
      AA_TO_YMD: `${year}1231`,
    });

    const url = `https://open.neis.go.kr/hub/SchoolSchedule?${params.toString()}`;
    const response = await fetch(url);
    const data = await response.json();

    const sched = data?.SchoolSchedule;
    if (!sched) break;

    totalCount = sched[0]?.head?.[0]?.list_total_count ?? 0;
    const pageRows = sched[1]?.row || [];
    rows.push(...pageRows);

    if (pageRows.length === 0) break;
    pIndex += 1;
  }

  return rows;
}

function escapeIcsText(text) {
  return String(text || "")
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\n/g, "\\n");
}

function nextDayYmd(ymd) {
  const y = parseInt(ymd.slice(0, 4), 10);
  const m = parseInt(ymd.slice(4, 6), 10);
  const d = parseInt(ymd.slice(6, 8), 10);
  const dt = new Date(Date.UTC(y, m - 1, d + 1));
  const pad2 = (n) => String(n).padStart(2, "0");
  return `${dt.getUTCFullYear()}${pad2(dt.getUTCMonth() + 1)}${pad2(dt.getUTCDate())}`;
}

module.exports = async (req, res) => {
  const apiKey = process.env.NEIS_API_KEY;

  if (!apiKey) {
    res.status(500).json({ error: "NEIS_API_KEY 환경변수가 설정되어 있지 않습니다." });
    return;
  }

  const nowYear = new Date().getFullYear();
  const years = [nowYear - 1, nowYear, nowYear + 1];

  try {
    const allRows = [];
    for (const year of years) {
      const rows = await fetchYearRows(apiKey, year);
      allRows.push(...rows);
    }

    // 같은 날짜/행사명이 학교급(초/중/고 등)별로 중복 등록되므로 날짜+행사명 기준으로 합칩니다.
    const merged = new Map();
    for (const row of allRows) {
      const key = `${row.AA_YMD}_${row.EVENT_NM}`;
      if (!merged.has(key)) {
        merged.set(key, {
          date: row.AA_YMD,
          name: row.EVENT_NM,
          content: (row.EVENT_CNTNT || "").trim(),
          type: row.SBTR_DD_SC_NM,
        });
      }
    }

    const events = Array.from(merged.values()).sort((a, b) => a.date.localeCompare(b.date));

    const now = new Date();
    const pad2 = (n) => String(n).padStart(2, "0");
    const dtStamp = `${now.getUTCFullYear()}${pad2(now.getUTCMonth() + 1)}${pad2(now.getUTCDate())}T${pad2(now.getUTCHours())}${pad2(now.getUTCMinutes())}${pad2(now.getUTCSeconds())}Z`;

    const lines = [];
    lines.push("BEGIN:VCALENDAR");
    lines.push("VERSION:2.0");
    lines.push("PRODID:-//kuhwa//NEIS School Schedule//KO");
    lines.push("CALSCALE:GREGORIAN");
    lines.push("METHOD:PUBLISH");
    lines.push("X-WR-CALNAME:한국구화학교 학사일정");
    lines.push("X-WR-TIMEZONE:Asia/Seoul");

    events.forEach((ev) => {
      lines.push("BEGIN:VEVENT");
      lines.push(`UID:${ev.date}-${Buffer.from(ev.name).toString("hex")}@kuhwa.vercel.app`);
      lines.push(`DTSTAMP:${dtStamp}`);
      lines.push(`DTSTART;VALUE=DATE:${ev.date}`);
      lines.push(`DTEND;VALUE=DATE:${nextDayYmd(ev.date)}`);
      lines.push(`SUMMARY:${escapeIcsText(ev.name)}`);
      if (ev.content) {
        lines.push(`DESCRIPTION:${escapeIcsText(ev.content)}`);
      }
      lines.push(`CATEGORIES:${escapeIcsText(ev.type || "학사일정")}`);
      lines.push("END:VEVENT");
    });

    lines.push("END:VCALENDAR");

    const body = lines.join("\r\n");

    res.setHeader("Content-Type", "text/calendar; charset=utf-8");
    const filename = encodeURIComponent("한국구화학교 학사일정.ics");
    res.setHeader(
      "Content-Disposition",
      `inline; filename="school-schedule.ics"; filename*=UTF-8''${filename}`
    );
    res.setHeader("Cache-Control", "s-maxage=3600, stale-while-revalidate");
    res.status(200).send(body);
  } catch (err) {
    res.status(502).json({ error: "NEIS API 호출에 실패했습니다.", detail: String(err) });
  }
};

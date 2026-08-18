// /api/schedule.js
// Vercel Serverless Function
// 한국구화학교(NEIS) 학사일정을 조회하여 JSON으로 반환합니다.

const ATPT_OFCDC_SC_CODE = "B10"; // 서울특별시교육청
const SD_SCHUL_CODE = "7010473"; // 한국구화학교

module.exports = async (req, res) => {
  const apiKey = process.env.NEIS_API_KEY;

  if (!apiKey) {
    res.status(500).json({ error: "NEIS_API_KEY 환경변수가 설정되어 있지 않습니다." });
    return;
  }

  const { year } = req.query || {};
  const targetYear = year || String(new Date().getFullYear());

  // NEIS SchoolSchedule API는 AY 파라미터를 제대로 필터링하지 않으므로
  // AA_FROM_YMD / AA_TO_YMD(연도 범위)로 직접 필터링합니다.
  const PAGE_SIZE = 1000;

  try {
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
        AA_FROM_YMD: `${targetYear}0101`,
        AA_TO_YMD: `${targetYear}1231`,
      });

      const url = `https://open.neis.go.kr/hub/SchoolSchedule?${params.toString()}`;
      const response = await fetch(url);
      const data = await response.json();

      const sched = data?.SchoolSchedule;
      if (!sched) {
        // 해당 데이터가 없는 경우 (RESULT INFO-200 등)
        break;
      }

      totalCount = sched[0]?.head?.[0]?.list_total_count ?? 0;
      const pageRows = sched[1]?.row || [];
      rows.push(...pageRows);

      if (pageRows.length === 0) break; // 안전장치: 무한루프 방지
      pIndex += 1;
    }

    if (rows.length === 0) {
      res.setHeader("Cache-Control", "s-maxage=3600, stale-while-revalidate");
      res.status(200).json({ school: "한국구화학교", year: targetYear, events: [] });
      return;
    }

    // 같은 날짜/행사명이 학교급(초/중/고 등)별로 중복 등록되므로 날짜+행사명 기준으로 합칩니다.
    const merged = new Map();
    for (const row of rows) {
      const key = `${row.AA_YMD}_${row.EVENT_NM}`;
      if (!merged.has(key)) {
        merged.set(key, {
          date: row.AA_YMD,
          name: row.EVENT_NM,
          content: (row.EVENT_CNTNT || "").trim(),
          type: row.SBTR_DD_SC_NM,
          courses: [row.SCHUL_CRSE_SC_NM].filter(Boolean),
        });
      } else {
        const existing = merged.get(key);
        if (row.SCHUL_CRSE_SC_NM && !existing.courses.includes(row.SCHUL_CRSE_SC_NM)) {
          existing.courses.push(row.SCHUL_CRSE_SC_NM);
        }
      }
    }

    const events = Array.from(merged.values()).sort((a, b) => a.date.localeCompare(b.date));

    res.setHeader("Cache-Control", "s-maxage=3600, stale-while-revalidate");
    res.status(200).json({ school: "한국구화학교", year: targetYear, events });
  } catch (err) {
    res.status(502).json({ error: "NEIS API 호출에 실패했습니다.", detail: String(err) });
  }
};

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createClient } from '@supabase/supabase-js';

/**
 * Dog Feeding Tracker
 * - React (JavaScript / JSX, not TypeScript)
 * - Korean time (Asia/Seoul), feeding day begins at 05:00
 * - Supabase public schema / feeding_logs table
 */
const TIME_ZONE = 'Asia/Seoul';
const GOAL_GRAMS = 100;
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
const supabase =
  supabaseUrl && supabaseAnonKey
    ? createClient(supabaseUrl, supabaseAnonKey)
    : null;

const dateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});
const displayDateFormatter = new Intl.DateTimeFormat('ko-KR', {
  timeZone: TIME_ZONE,
  year: 'numeric',
  month: 'long',
  day: 'numeric',
  weekday: 'long',
});
const displayTimeFormatter = new Intl.DateTimeFormat('ko-KR', {
  timeZone: TIME_ZONE,
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

// Shift the timestamp by 5 hours before resolving its calendar date in Korea.
// Example: Nov 18 02:00 KST => feeding date Nov 17.
function feedingDateFor(date = new Date()) {
  const shifted = new Date(date.getTime() - 5 * 60 * 60 * 1000);
  const parts = dateFormatter.formatToParts(shifted);
  const lookup = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${lookup.year}-${lookup.month}-${lookup.day}`;
}

function readableDate(day) {
  return displayDateFormatter.format(new Date(`${day}T12:00:00+09:00`));
}

function readableTime(isoString) {
  return displayTimeFormatter.format(new Date(isoString));
}

function sortNewestFirst(entries) {
  return [...entries].sort((a, b) => {
    const timeDiff = new Date(b.fed_at).getTime() - new Date(a.fed_at).getTime();
    return timeDiff || String(b.id).localeCompare(String(a.id));
  });
}

function Icon({ name, size = 20 }) {
  const paths = {
    paw: <><circle cx="6" cy="7" r="1.3" /><circle cx="11" cy="5" r="1.3" /><circle cx="16" cy="7" r="1.3" /><circle cx="19" cy="11" r="1.3" /><path d="M12 11.5c-2.1 0-3.3 1.6-4.4 3.1-.6.8-1.5 1.4-1.5 2.5 0 1.3 1 2.3 2.4 2.3 1.3 0 2.3-.8 3.5-.8s2.2.8 3.5.8c1.4 0 2.4-1 2.4-2.3 0-1.1-.9-1.7-1.5-2.5-1.1-1.5-2.3-3.1-4.4-3.1Z" /></>,
    clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
    trash: <><path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5" /></>,
    calendar: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M7 3v4M17 3v4M3 10h18" /></>,
    arrow: <path d="m14 6-6 6 6 6" />,
    check: <path d="m5 12 4 4L19 6" />,
    warning: <><path d="m12 3 10 18H2L12 3Z" /><path d="M12 9v5M12 17h.01" /></>,
    refresh: <><path d="M20 7v5h-5M4 17v-5h5" /><path d="M6 9a7 7 0 0 1 12-2l2 5M4 12l2 5a7 7 0 0 0 12-2" /></>,
  };
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {paths[name]}
    </svg>
  );
}

export default function App() {
  const [today, setToday] = useState(() => feedingDateFor());
  const [page, setPage] = useState('today');
  const [logs, setLogs] = useState([]);
  const [historyLogs, setHistoryLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const actionLock = useRef(false);
  const requestId = useRef(0);

  const refreshToday = useCallback(async (day) => {
    if (!supabase) { setLoading(false); return; }
    const currentRequest = ++requestId.current;
    setLoading(true);
    setError('');
    const { data, error: queryError } = await supabase
      .from('feeding_logs')
      .select('id, feeding_date, fed_at, grams')
      .eq('feeding_date', day)
      .order('fed_at', { ascending: false });
    if (currentRequest !== requestId.current) return;
    if (queryError) setError(`기록을 불러오지 못했어요: ${queryError.message}`);
    else setLogs(data ?? []);
    setLoading(false);
  }, []);

  const refreshHistory = useCallback(async () => {
    if (!supabase) return;
    setHistoryLoading(true);
    setError('');
    // Supabase responses are commonly limited to 1,000 rows per request.
    // Fetch pages to include all past entries.
    const all = [];
    const pageSize = 500;
    let index = 0;
    let loadError = null;
    while (true) {
      const { data, error: queryError } = await supabase
        .from('feeding_logs')
        .select('id, feeding_date, fed_at, grams')
        .order('fed_at', { ascending: false })
        .order('id', { ascending: false })
        .range(index, index + pageSize - 1);
      if (queryError) { loadError = queryError; break; }
      all.push(...(data ?? []));
      if (!data || data.length < pageSize) break;
      index += pageSize;
    }
    if (loadError) setError(`지난 기록을 불러오지 못했어요: ${loadError.message}`);
    else setHistoryLogs(all);
    setHistoryLoading(false);
  }, []);

  useEffect(() => { refreshToday(today); }, [today, refreshToday]);
  useEffect(() => { if (page === 'history') refreshHistory(); }, [page, refreshHistory]);

  // Check periodically and when the app regains focus, so the displayed day
  // updates even if the app was left open across 05:00 KST.
  useEffect(() => {
    const syncDay = () => {
      const nextDay = feedingDateFor();
      setToday((current) => current === nextDay ? current : nextDay);
    };
    const timer = setInterval(syncDay, 15_000);
    window.addEventListener('focus', syncDay);
    document.addEventListener('visibilitychange', syncDay);
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', syncDay);
      document.removeEventListener('visibilitychange', syncDay);
    };
  }, []);

  const total = useMemo(() => logs.reduce((sum, item) => sum + item.grams, 0), [logs]);
  const remaining = GOAL_GRAMS - total;
  const sortedLogs = useMemo(() => sortNewestFirst(logs), [logs]);
  const historyGroups = useMemo(() => {
    const grouped = new Map();
    for (const item of historyLogs) {
      const group = grouped.get(item.feeding_date) ?? { date: item.feeding_date, grams: 0, count: 0 };
      group.grams += item.grams;
      group.count += 1;
      grouped.set(item.feeding_date, group);
    }
    return Array.from(grouped.values())
      .filter((item) => item.date < today)
      .sort((a, b) => b.date.localeCompare(a.date));
  }, [historyLogs, today]);

  async function addFeeding(grams) {
    if (!supabase || actionLock.current) return;
    actionLock.current = true;
    setSaving(true);
    setError('');
    setMessage('');
    // Re-check the day right at the click, including the 05:00 boundary.
    const fedAt = new Date();
    const feedingDate = feedingDateFor(fedAt);
    if (feedingDate !== today) setToday(feedingDate);
    const { data, error: insertError } = await supabase
      .from('feeding_logs')
      .insert({ feeding_date: feedingDate, fed_at: fedAt.toISOString(), grams })
      .select('id, feeding_date, fed_at, grams')
      .single();
    if (insertError) setError(`저장하지 못했어요: ${insertError.message}`);
    else if (feedingDate === today) {
      setLogs((current) => [data, ...current]);
      setMessage(`${grams}g을 기록했어요.`);
    } else {
      // Day changed while saving; refresh from server on new-day render.
      setMessage(`${readableDate(feedingDate)}에 ${grams}g을 기록했어요.`);
    }
    setSaving(false);
    actionLock.current = false;
  }

  async function deleteFeeding(entry) {
    if (!supabase || actionLock.current) return;
    if (!window.confirm(`${readableTime(entry.fed_at)}에 기록한 ${entry.grams}g을 삭제할까요?`)) return;
    actionLock.current = true;
    setDeleting(entry.id);
    setError('');
    setMessage('');
    const { error: deleteError } = await supabase
      .from('feeding_logs')
      .delete()
      .eq('id', entry.id)
      .eq('feeding_date', today);
    if (deleteError) setError(`삭제하지 못했어요: ${deleteError.message}`);
    else {
      setLogs((current) => current.filter((item) => item.id !== entry.id));
      setMessage('급여 기록을 삭제했어요.');
    }
    setDeleting(null);
    actionLock.current = false;
  }

  return (
    <>
      <style>{styles}</style>
      <div className="app-shell">
        <header className="topbar">
          <div className="brand-mark"><Icon name="paw" size={24} /></div>
          <div className="brand-text">
            <span className="brand-label">DAILY FEEDING</span>
            <strong>우리 강아지 밥 기록</strong>
          </div>
        </header>

        {!supabase && (
          <div className="alert alert-error" role="alert">
            <Icon name="warning" size={19} />
            <span>Supabase 환경변수가 없어요. <code>.env.local</code>에 VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY를 설정해 주세요.</span>
          </div>
        )}
        {error && <div className="alert alert-error" role="alert"><Icon name="warning" size={19}/><span>{error}</span></div>}
        {message && !error && <div className="alert alert-success" role="status"><Icon name="check" size={18}/><span>{message}</span></div>}

        {page === 'today' ? (
          <main className="content">
            <div className="page-heading">
              <span className="eyebrow">오늘의 급여</span>
              <h1>{readableDate(today)}</h1>
              <p>급여일은 매일 오전 5시에 바뀌어요.</p>
            </div>

            <section className="summary-card" aria-label="오늘 급여 현황">
              <span className="summary-label">지금까지 먹은 양</span>
              <div className="total-line"><strong>{total}</strong><span> / {GOAL_GRAMS}g</span></div>
              <div className="progress-track" role="progressbar" aria-label="하루 목표 달성률" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.min(Math.round(total / GOAL_GRAMS * 100), 100)}>
                <div className={`progress-fill ${remaining < 0 ? 'is-over' : ''}`} style={{ width: `${Math.min(total / GOAL_GRAMS * 100, 100)}%` }} />
              </div>
              <p className={`summary-note ${remaining < 0 ? 'over' : ''}`}>
                {remaining > 0 ? `목표까지 ${remaining}g 남았어요` : remaining === 0 ? '오늘 목표량을 채웠어요!' : `목표보다 ${Math.abs(remaining)}g 초과했어요`}
              </p>
            </section>

            <section className="feed-section" aria-label="사료 급여량 추가">
              <div className="section-title"><h2>사료 추가하기</h2><span>1스쿱 = 10g</span></div>
              <div className="feed-buttons">
                {[10, 20, 30].map((grams) => (
                  <button className={`feed-button ${grams === 10 ? 'primary' : ''}`} key={grams} disabled={!supabase || saving || deleting !== null || loading} onClick={() => addFeeding(grams)}>
                    <span className="plus">+</span>{grams}<small>g</small>
                  </button>
                ))}
              </div>
            </section>

            <section className="log-section" aria-label="오늘 급여 내역">
              <div className="section-title">
                <h2>오늘 급여 내역</h2>
                <button className="refresh-button" type="button" onClick={() => refreshToday(today)} disabled={!supabase || loading || saving || deleting !== null} title="최신 기록 불러오기" aria-label="기록 새로고침"><Icon name="refresh" size={18}/></button>
              </div>
              <div className="log-card">
                {loading ? <p className="empty">기록을 불러오는 중…</p> : sortedLogs.length === 0 ? (
                  <div className="empty"><Icon name="paw" size={28} /><p>아직 기록이 없어요.<br/>사료를 주고 버튼을 눌러주세요.</p></div>
                ) : sortedLogs.map((entry) => (
                  <div className="log-row" key={entry.id}>
                    <div className="log-time"><Icon name="clock" size={17}/><time dateTime={entry.fed_at}>{readableTime(entry.fed_at)}</time></div>
                    <div className="log-right"><strong>+{entry.grams}g</strong><button className="delete-button" type="button" onClick={() => deleteFeeding(entry)} disabled={saving || deleting !== null} aria-label={`${readableTime(entry.fed_at)} ${entry.grams}g 기록 삭제`} title="삭제"><Icon name="trash" size={18}/></button></div>
                  </div>
                ))}
              </div>
            </section>
            <button className="history-link" type="button" onClick={() => { setPage('history'); setMessage(''); setError(''); }}><span className="history-link-title"><Icon name="calendar" size={20}/> 지난 기록 보기</span><span className="chevron">›</span></button>
          </main>
        ) : (
          <main className="content">
            <div className="history-heading"><button type="button" className="back-button" onClick={() => { setPage('today'); setMessage(''); setError(''); }} aria-label="오늘 화면으로 돌아가기"><Icon name="arrow" size={21}/></button><div><span className="eyebrow">FEEDING HISTORY</span><h1>지난 기록</h1></div></div>
            <p className="history-description">지난 날짜별 총급여량이에요. 오늘 기록은 메인 화면에서 확인하세요.</p>
            <div className="history-card">
              {historyLoading ? <p className="empty">지난 기록을 불러오는 중…</p> : historyGroups.length === 0 ? <p className="empty">아직 지난 기록이 없어요.</p> : historyGroups.map((group) => (
                <div className="history-row" key={group.date}>
                  <div><strong>{readableDate(group.date)}</strong><span>{group.count}번 급여</span></div>
                  <div className="history-amount"><strong>{group.grams}g</strong><small className={group.grams > GOAL_GRAMS ? 'over' : ''}>{group.grams > GOAL_GRAMS ? `+${group.grams - GOAL_GRAMS}g 초과` : `${Math.round(group.grams / GOAL_GRAMS * 100)}%`}</small></div>
                </div>
              ))}
            </div>
          </main>
        )}
        <footer>하루 기준 · 오전 5:00 ~ 다음 날 오전 4:59 (한국 시간)</footer>
      </div>
    </>
  );
}

const styles = `
  @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700;800&family=Noto+Sans+KR:wght@400;500;600;700;800&display=swap');
  :root { font-family: 'DM Sans', 'Noto Sans KR', system-ui, sans-serif; color: #26362c; background: #f7f8f4; font-synthesis: none; }
  * { box-sizing: border-box; }
  body { margin: 0; min-width: 320px; }
  button { font: inherit; cursor: pointer; }
  button:disabled { cursor: not-allowed; opacity: .48; }
  .app-shell { max-width: 520px; min-height: 100dvh; margin: 0 auto; padding: 24px 22px 24px; }
  .topbar { display: flex; align-items: center; gap: 11px; margin-bottom: 38px; }
  .brand-mark { display: flex; align-items: center; justify-content: center; flex: 0 0 44px; height: 44px; border-radius: 15px; color: #fff; background: #347659; }
  .brand-text { display: flex; flex-direction: column; gap: 2px; }
  .brand-label { font-size: 10px; letter-spacing: 1.6px; font-weight: 800; color: #6d8b76; }
  .brand-text strong { font-size: 15px; letter-spacing: -.5px; }
  .content { display: flex; flex-direction: column; gap: 24px; }
  .page-heading { margin-bottom: 1px; }
  .eyebrow { font-size: 12px; font-weight: 800; color: #56846b; letter-spacing: .6px; }
  h1 { font-size: clamp(23px, 5.6vw, 29px); font-weight: 800; letter-spacing: -1.1px; margin: 8px 0 5px; line-height: 1.35; }
  .page-heading p, .history-description { color: #829087; margin: 0; font-size: 13px; }
  .summary-card { padding: 28px 25px 24px; border-radius: 24px; background: #fff; border: 1px solid #e8eee7; box-shadow: 0 9px 28px rgba(48, 79, 57, .035); }
  .summary-label { font-size: 14px; font-weight: 600; color: #718076; }
  .total-line { display: flex; align-items: baseline; gap: 3px; margin: 3px 0 17px; }
  .total-line strong { font-size: clamp(62px, 15vw, 78px); font-weight: 800; line-height: 1.2; letter-spacing: -4px; font-variant-numeric: tabular-nums; }
  .total-line span { font-size: 22px; color: #9aa79c; font-weight: 600; }
  .progress-track { height: 11px; width: 100%; background: #ecf1ea; border-radius: 50px; overflow: hidden; }
  .progress-fill { height: 100%; background: #4d9a70; border-radius: inherit; transition: width 220ms ease; }
  .progress-fill.is-over { background: #d48b57; }
  .summary-note { font-size: 13px; margin: 11px 0 0; color: #56846b; font-weight: 600; }
  .summary-note.over, .history-amount small.over { color: #bc7549; }
  .section-title { display: flex; justify-content: space-between; align-items: center; margin-bottom: 13px; }
  .section-title h2 { margin: 0; font-size: 17px; letter-spacing: -.5px; }
  .section-title > span { font-size: 12px; color: #90a096; }
  .feed-buttons { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }
  .feed-button { min-height: 80px; border-radius: 18px; border: 1px solid #dce7dc; background: #fff; font-size: 28px; font-weight: 800; color: #397557; box-shadow: 0 3px 12px rgba(45, 91, 55, .035); transition: transform 100ms ease, background 100ms ease; }
  .feed-button:active:not(:disabled) { transform: scale(.97); }
  .feed-button.primary { color: white; background: #347659; border-color: #347659; }
  .feed-button .plus { font-size: 19px; vertical-align: 3px; margin-right: 2px; }
  .feed-button small { font-size: 15px; margin-left: 2px; font-weight: 600; }
  .log-section { margin-top: 4px; }
  .log-card, .history-card { background: #fff; border: 1px solid #e8eee7; border-radius: 19px; overflow: hidden; }
  .log-row { min-height: 65px; padding: 12px 17px 12px 20px; display: flex; align-items: center; justify-content: space-between; gap: 14px; border-bottom: 1px solid #f0f2ed; }
  .log-row:last-child, .history-row:last-child { border-bottom: 0; }
  .log-time, .log-right { display: flex; align-items: center; gap: 9px; }
  .log-time { color: #7f8e83; font-size: 14px; }
  .log-time time { font-variant-numeric: tabular-nums; }
  .log-right { gap: 16px; }
  .log-right strong { font-size: 17px; font-variant-numeric: tabular-nums; }
  .delete-button, .refresh-button, .back-button { display: flex; align-items: center; justify-content: center; border: 0; background: transparent; color: #a6b1aa; border-radius: 8px; }
  .delete-button { min-width: 34px; height: 34px; }
  .delete-button:hover { color: #c6655d; background: #fff3f1; }
  .refresh-button { width: 32px; height: 32px; }
  .refresh-button:hover, .back-button:hover { background: #edf2ec; color: #347659; }
  .empty { text-align: center; padding: 30px 15px; color: #92a196; font-size: 14px; line-height: 1.7; }
  .empty svg { color: #b3c7b8; }
  .empty p { margin: 9px 0 0; }
  .history-link { padding: 16px 20px; border: 1px solid #e2eae0; border-radius: 16px; background: #edf3ea; width: 100%; display: flex; justify-content: space-between; align-items: center; color: #386e51; font-size: 15px; font-weight: 700; }
  .history-link-title { display: flex; align-items: center; gap: 10px; }
  .chevron { font-size: 27px; font-weight: 400; line-height: 15px; }
  .history-heading { display: flex; align-items: center; gap: 14px; }
  .history-heading h1 { margin-bottom: 0; }
  .back-button { flex: 0 0 42px; height: 42px; border: 1px solid #e0eae1; background: #fff; color: #3e7455; }
  .history-description { margin-top: -12px; }
  .history-row { display: flex; justify-content: space-between; align-items: center; padding: 20px; border-bottom: 1px solid #f0f2ed; gap: 16px; }
  .history-row > div:first-child, .history-amount { display: flex; flex-direction: column; gap: 5px; }
  .history-row strong { font-size: 14px; }
  .history-row span, .history-amount small { color: #92a096; font-size: 12px; }
  .history-amount { align-items: flex-end; white-space: nowrap; }
  .history-amount strong { font-size: 20px; }
  .alert { padding: 12px 15px; margin-bottom: 18px; border-radius: 12px; display: flex; gap: 10px; align-items: flex-start; font-size: 12px; line-height: 1.6; }
  .alert svg { flex-shrink: 0; margin-top: 1px; }
  .alert-error { color: #a34c42; background: #fff0eb; border: 1px solid #f4d7ce; }
  .alert-success { color: #3b7651; background: #e9f4e9; border: 1px solid #cfe7cf; }
  .alert code { overflow-wrap: anywhere; }
  footer { margin-top: 36px; text-align: center; color: #a0ada1; font-size: 11px; line-height: 1.8; }
  @media (max-width: 370px) { .app-shell { padding: 20px 15px; } .feed-button { font-size: 24px; } .log-row { padding-left: 14px; padding-right: 10px; } }
`;

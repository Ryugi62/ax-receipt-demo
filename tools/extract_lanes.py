#!/usr/bin/env python3
"""AI 작업 기록(lanes.jsonl)에서 업무 종류별 건수·소요 분만 집계한다. 설명 글·이름·금액은 출력하지 않는다.
사용: python3 extract_lanes.py <lanes.jsonl> <출력.json> [시작일 종료일]
방법: 작업 시작 기록(launched)과 같은 설명의 첫 종료 기록(done) 시각 차이 = 소요 분. 종료 기록이 없거나 24시간을 넘으면 표본에서 뺀다.
업무 종류 = 설명 낱말 규칙(아래 RULES, 위에서부터 첫 일치). 돈·성적·건강 목표 작업과 민감 낱말이 든 작업은 집계에서 뺀다."""
import json, sys, datetime, statistics

RULES = [
    ('심사·검토', ['블라인드', '모의', '심사', '채점', '판정', '레드팀', '게이트', '점검', '감사', '대조']),
    ('제출·접수', ['제출', '접수', '등록', '신청', '발송']),
    ('조사·분석', ['조사', '분석', '도시에', '실측', '판독', '리서치', '원문', '공고']),
    ('문서 작성', ['원고', '기획서', '제안서', '보고서', '서류', '서식', '작성']),
    ('제작·구현', ['제작', '구현', '수리', '개발', '영상', '덱', '빌드', '코드', '시연', '시스템']),
    ('정리·운영', ['정리', '볼트', '이슈', '크기', '스윕', '보강', '반영', '수정', '개선']),
]
EXCLUDE_GOALS = {'돈', '성적', '몸·회복', '커리어'}
EXCLUDE_WORDS = ['병원', '건강', '연애', '가족', '친구', '송금', '입금', '대출', '세금', '급여', '결제', '카드값', '연락', '통장']
MAX_MIN = 24 * 60

def classify(desc):
    for kind, keys in RULES:
        if any(k in desc for k in keys): return kind
    return '기타'

def is_excluded(row):
    if row.get('goal') in EXCLUDE_GOALS: return True
    d = row.get('description', '')
    return any(w in d for w in EXCLUDE_WORDS)

def _t(s):
    import re
    s = re.sub(r'([+-]\d{2})(\d{2})$', r'\1:\2', s.strip().replace('Z', '+00:00'))
    d = datetime.datetime.fromisoformat(s)
    return d if d.tzinfo else d.replace(tzinfo=datetime.timezone(datetime.timedelta(hours=9)))

def aggregate(rows, start=None, end=None):
    launches = [r for r in rows if 'launched' in r]
    dones = {}
    for r in rows:
        if r.get('done') and 'ts' in r: dones.setdefault(r['description'], []).append(_t(r['ts']))
    if start: launches = [r for r in launches if r['launched'][:10] >= start]
    if end: launches = [r for r in launches if r['launched'][:10] <= end]
    out = {'launched': len(launches), 'excluded_privacy': 0, 'no_end_or_overlong': 0, 'sample': 0, 'types': {}}
    mins = {}; days = []
    for r in sorted(launches, key=lambda x: _t(x['launched'])):
        if is_excluded(r): out['excluded_privacy'] += 1; continue
        t0 = _t(r['launched'])
        ends = sorted(x for x in dones.get(r['description'], []) if x >= t0)
        m = (ends[0] - t0).total_seconds() / 60 if ends else None
        if ends: dones[r['description']].remove(ends[0])  # 종료 기록 1개는 시작 기록 1개에만 쓴다
        if m is None or m > MAX_MIN: out['no_end_or_overlong'] += 1; continue
        k = classify(r['description']); mins.setdefault(k, []).append(m); days.append(r['launched'][:10])
    for k, v in sorted(mins.items(), key=lambda kv: -sum(kv[1])):
        out['types'][k] = {'count': len(v), 'minutes': round(sum(v)), 'median_min': round(statistics.median(v))}
    out['sample'] = sum(t['count'] for t in out['types'].values())
    out['total_minutes'] = sum(t['minutes'] for t in out['types'].values())
    out['period_start'] = min(days) if days else None
    out['period_end'] = max(days) if days else None
    out['active_days'] = len(set(days))
    return out

if __name__ == '__main__':
    src, dst = sys.argv[1], sys.argv[2]
    s = sys.argv[3] if len(sys.argv) > 3 else None; e = sys.argv[4] if len(sys.argv) > 4 else None
    rows = [json.loads(l) for l in open(src, encoding='utf-8') if l.strip()]
    a = aggregate(rows, s, e)
    a['method'] = '작업 시작 기록과 같은 설명의 첫 종료 기록 사이의 분. 종료 기록 없음·24시간 초과·민감 목표 작업은 표본에서 제외. 업무 종류는 설명 낱말 규칙(tools/extract_lanes.py RULES).'
    a['source'] = 'AI 작업 기록 파일 1개(제안자 본인 1인 사업체 운영 중 AI에게 맡긴 작업의 시작·종료 시각)'
    json.dump(a, open(dst, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    if dst.endswith('.json'):  # file:// 로 열어도 읽히도록 같은 내용을 스크립트로도 낸다
        open(dst[:-5] + '.js', 'w', encoding='utf-8').write('var MEASURED_AGG = ' + json.dumps(a, ensure_ascii=False) + ';\n')
    print(json.dumps(a, ensure_ascii=False))

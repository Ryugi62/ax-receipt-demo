import unittest, sys, os
sys.path.insert(0, os.path.dirname(__file__))
import extract_lanes as X

def L(desc, t, goal='공모'): return {'launched': t, 'deadline': t, 'description': desc, 'goal': goal}
def D(desc, t): return {'description': desc, 'done': True, 'ts': t}

class T(unittest.TestCase):
    def test_classify_kinds(self):
        self.assertEqual(X.classify('블라인드 모의 심사 3인'), '심사·검토')
        self.assertEqual(X.classify('아이디어 도시에 조사'), '조사·분석')
        self.assertEqual(X.classify('서식2 원고 작성'), '문서 작성')
        self.assertEqual(X.classify('시연판 구현'), '제작·구현')
        self.assertEqual(X.classify('최종 제출 접수'), '제출·접수')
        self.assertEqual(X.classify('볼트 정리'), '정리·운영')
        self.assertEqual(X.classify('알 수 없는 말'), '기타')

    def test_privacy_exclusion_by_goal_and_word(self):
        self.assertTrue(X.is_excluded(L('아무 일', '2026-10-01T10:00:00+09:00', goal='돈')))
        self.assertTrue(X.is_excluded(L('병원 예약', '2026-10-01T10:00:00+09:00')))
        self.assertFalse(X.is_excluded(L('서식 작성', '2026-10-01T10:00:00+09:00')))

    def test_pairing_minutes(self):
        rows = [L('서식 작성', '2026-10-01T10:00:00+09:00'), D('서식 작성', '2026-10-01T10:30:00+09:00')]
        a = X.aggregate(rows)
        self.assertEqual(a['sample'], 1)
        self.assertEqual(a['types']['문서 작성']['count'], 1)
        self.assertEqual(a['types']['문서 작성']['minutes'], 30)

    def test_unfinished_and_overlong_not_counted(self):
        rows = [L('서식 작성', '2026-10-01T10:00:00+09:00'),
                L('시연판 구현', '2026-10-01T10:00:00+09:00'), D('시연판 구현', '2026-10-05T10:00:00+09:00')]
        a = X.aggregate(rows)
        self.assertEqual(a['sample'], 0)
        self.assertEqual(a['launched'], 2)
        self.assertEqual(a['no_end_or_overlong'], 2)

    def test_output_has_no_description_text(self):
        rows = [L('고유한비밀낱말 서식 작성', '2026-10-01T10:00:00+09:00'), D('고유한비밀낱말 서식 작성', '2026-10-01T10:30:00+09:00')]
        import json
        self.assertNotIn('고유한비밀낱말', json.dumps(X.aggregate(rows), ensure_ascii=False))

    def test_mixed_time_formats(self):
        rows = [L('서식 작성', '2026-10-01T10:00:00+09:00'), D('서식 작성', '2026-10-01T10:30:00+0900'),
                L('서식 작성', '2026-10-02T10:00:00'), D('서식 작성', '2026-10-02T10:10:00+09:00')]
        a = X.aggregate(rows)
        self.assertEqual(a['sample'], 2)

    def test_one_end_used_once(self):
        rows = [L('서식 작성', '2026-10-01T10:00:00+09:00'), L('서식 작성', '2026-10-01T10:05:00+09:00'), D('서식 작성', '2026-10-01T10:30:00+09:00')]
        a = X.aggregate(rows)
        self.assertEqual(a['sample'], 1)

    def test_period(self):
        rows = [L('서식 작성', '2026-10-01T10:00:00+09:00'), D('서식 작성', '2026-10-01T10:30:00+09:00'),
                L('서식 작성', '2026-10-09T10:00:00+09:00'), D('서식 작성', '2026-10-09T10:20:00+09:00')]
        a = X.aggregate(rows)
        self.assertEqual((a['period_start'], a['period_end']), ('2026-10-01', '2026-10-09'))
        self.assertEqual(a['types']['문서 작성']['count'], 2)
        self.assertEqual(a['types']['문서 작성']['median_min'], 25)

if __name__ == '__main__': unittest.main()

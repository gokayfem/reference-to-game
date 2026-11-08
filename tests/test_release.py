import importlib.util, json, subprocess, sys, tempfile, unittest, shutil
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'skills/reference-to-game/scripts'))
from r2g.core import init_case,read,write,validate,digest,fingerprint,CHECKS

class Release(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup);self.case=Path(self.tmp.name)/'case'
        init_case(self.case,brief='Monochrome puzzle')
        (self.case/'app/main.js').write_text('export const game = 1;')
        s=read(self.case/'style.json');s.update(status='locked',palette=[{'role':'paper','hex':'#fafafa','reference_id':None}],camera='top down',nonnegotiables=['monochrome']);write(self.case/'style.json',s)
        g=read(self.case/'game.json');g.update(status='ready',actions=['move'],invariants=['one move once'],loop={'goal':'reach goal','success':'at goal','failure_or_pressure':'limited moves','restart':'reset state'});write(self.case/'game.json',g)
        (self.case/'review/proof.txt').write_text('Synthetic evidence, not an actual game verdict.')
        r=read(self.case/'review.json');r['build_fingerprint']=fingerprint(self.case)[0]
        for check in CHECKS:r['checks'][check]={'status':'passed','notes':'synthetic attestation for validator test','evidence':[{'path':'review/proof.txt','sha256':digest(self.case/'review/proof.txt')}]}
        write(self.case/'review.json',r)
    def test_complete_manifest_passes_without_claiming_artistic_truth(self):self.assertEqual(validate(self.case,True),[])
    def test_changed_source_invalidates_review(self):
        (self.case/'app/main.js').write_text('changed')
        self.assertTrue(any('stale' in e for e in validate(self.case,True)))
    def test_changed_evidence_fails(self):
        (self.case/'review/proof.txt').write_text('substituted')
        self.assertTrue(any('evidence missing or changed' in e for e in validate(self.case,True)))
    def test_unreviewed_category_fails(self):
        r=read(self.case/'review.json');r['checks']['playability']['status']='pending';write(self.case/'review.json',r)
        self.assertTrue(any('playability review not passed' in e for e in validate(self.case,True)))
    def test_malformed_contract_returns_error_instead_of_crashing(self):
        c=read(self.case/'case.json');c['references']=['bad'];write(self.case/'case.json',c)
        self.assertTrue(validate(self.case))
    def test_copied_skill_runs_outside_repo(self):
        root=Path(self.tmp.name);skill=root/'portable-skill'
        source=Path(__file__).resolve().parents[1]/'skills/reference-to-game'
        shutil.copytree(source,skill,ignore=shutil.ignore_patterns('__pycache__'))
        target=root/'external-game'
        r=subprocess.run([sys.executable,str(skill/'scripts/r2g.py'),'init',str(target),'--brief','A quiet charcoal mystery'],cwd=root,capture_output=True,text=True)
        self.assertEqual(r.returncode,0,r.stderr);self.assertTrue((target/'case.json').exists())
        r=subprocess.run([sys.executable,str(skill/'scripts/r2g.py'),'install-core',str(target)],cwd=root,capture_output=True,text=True)
        self.assertEqual(r.returncode,0,r.stderr);self.assertTrue((target/'app/lib/reference-core/core.mjs').exists())

    def test_review_page_escapes_untrusted_text(self):
        from r2g.viewer import page
        c=read(self.case/'case.json');c['brief']='<script>alert(1)</script>';write(self.case/'case.json',c)
        output=page(self.case).read_text()
        self.assertNotIn('<script>',output);self.assertIn('&lt;script&gt;',output)

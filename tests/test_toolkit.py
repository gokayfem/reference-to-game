import json, sys, tempfile, unittest, subprocess, shutil
from pathlib import Path
from unittest.mock import Mock
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'skills/reference-to-game/scripts'))
from r2g.core import init_case,read,write,validate,digest,fingerprint,make_prompt,contained
from r2g.fal import submit,status,queue_url
from r2g.media import palette,compare,inspect
from PIL import Image

class Toolkit(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup);self.root=Path(self.tmp.name);self.case=self.root/'case'
    def init(self,**kwargs):return init_case(self.case,**kwargs)
    def test_text_only_is_valid_and_neutral(self):
        self.init(brief='A restrained charcoal detective game',engine='godot')
        self.assertEqual(validate(self.case),[]);self.assertEqual(read(self.case/'style.json')['palette'],[])
        p=make_prompt(self.case);self.assertIn('godot',p);self.assertIn('charcoal',p);self.assertNotIn('9 scenes',p)
        self.assertTrue(validate(self.case,True))
    def test_mixed_inputs_preserve_bytes_and_identity(self):
        d=self.root/'inputs';d.mkdir();(d/'notes.md').write_text('turn based');Image.new('RGB',(13,29),'#345678').save(d/'PORTRAIT.PNG');(d/'hero.glb').write_bytes(b'glTFtest')
        c=self.init(inputs=[str(d),'https://example.com/design'],brief='mix')
        self.assertEqual({r['kind'] for r in c['references']},{'document','image','model','url'})
        for r in c['references']:
            if r['path']:self.assertEqual(digest(self.case/r['path']),r['sha256'])
        self.assertEqual(validate(self.case),[])
    def test_symlinks_and_hidden_inputs_are_not_followed(self):
        d=self.root/'inputs';d.mkdir();(d/'a.txt').write_text('ok');(d/'.env').write_text('private');(d/'link.txt').symlink_to(d/'a.txt')
        c=self.init(inputs=[str(d)]);self.assertEqual(len(c['references']),1)
    def test_duplicate_basenames_do_not_overwrite(self):
        a=self.root/'a';b=self.root/'b';a.mkdir();b.mkdir();(a/'x.txt').write_text('one');(b/'x.txt').write_text('two')
        c=self.init(inputs=[str(a),str(b)]);self.assertEqual(len({x['path'] for x in c['references']}),2)
    def test_invalid_intake_leaves_no_partial_case(self):
        with self.assertRaises(ValueError):self.init(inputs=['/nonexistent/reference'])
        self.assertFalse(self.case.exists())
    def test_existing_case_never_overwritten(self):
        self.init(brief='one')
        with self.assertRaises(ValueError):self.init(brief='two')
        self.assertEqual(read(self.case/'case.json')['brief'],'one')
    def test_reference_tampering_fails(self):
        p=self.root/'ref.txt';p.write_text('original');self.init(inputs=[str(p)])
        r=read(self.case/'case.json')['references'][0];(self.case/r['path']).write_text('changed')
        self.assertTrue(any('changed' in x for x in validate(self.case)))
    def test_path_escape_fails(self):
        self.init(brief='safe')
        with self.assertRaises(ValueError):contained(self.case,'../outside')
    def test_url_is_recorded_without_fetch(self):
        c=self.init(inputs=['https://example.com/ref.png']);self.assertEqual(c['references'][0]['inspection'],'link-only')
        self.assertEqual(inspect(self.case)[0]['inspection'],'link-only')
    def test_semantic_palette_works_on_odd_and_transparent_images(self):
        p=self.root/'a.png';Image.new('RGBA',(7,19),(40,80,120,255)).save(p)
        result=palette(p,[{'role':'ink','uv':[1,0]}]);self.assertEqual(result[0]['hex'],'#285078')
        Image.new('RGBA',(7,19),(0,0,0,0)).save(p)
        with self.assertRaises(ValueError):palette(p,[{'role':'ink','uv':[0,0]}])
    def test_palette_out_of_bounds_rejected(self):
        p=self.root/'a.png';Image.new('RGB',(8,8),'white').save(p)
        with self.assertRaises(ValueError):palette(p,[{'role':'paper','uv':[2,0]}])
    def test_comparison_preserves_aspect_and_requires_review(self):
        a=self.root/'a.png';b=self.root/'b.png';Image.new('RGB',(31,71),'red').save(a);Image.new('RGB',(97,13),'blue').save(b)
        result=compare(a,b,self.root/'compare.png',128)
        self.assertEqual(result['reference_size'],[31,71]);self.assertEqual(result['verdict'],'human-review-required')
    def test_source_fingerprint_changes_and_excludes_dependency_noise(self):
        self.init(brief='case');(self.case/'app/main.js').write_text('1');sha,_=fingerprint(self.case)
        d=self.case/'app/node_modules';d.mkdir();(d/'x').write_text('dependency');self.assertEqual(fingerprint(self.case)[0],sha)
        (self.case/'app/main.js').write_text('2');self.assertNotEqual(fingerprint(self.case)[0],sha)
    def configure_fal(self):
        self.init(brief='test');c=read(self.case/'case.json');c['generation']={'enabled':True,'budget_usd':1};write(self.case/'case.json',c)
        write(self.case/'assets.json',{'items':[{'id':'hero','references':[]}]})
    def test_dry_run_is_offline_and_creates_no_job(self):
        self.configure_fal();send=Mock();r=submit(self.case,'hero','fal-ai/example',{'prompt':'one'},.2,send=send)
        self.assertTrue(r['dry_run']);send.assert_not_called();self.assertFalse((self.case/'production/fal').exists())
    def test_fal_dedup_and_completed_poll(self):
        self.configure_fal();send=Mock(return_value={'request_id':'abc','status_url':'https://queue.fal.run/a/b/requests/abc/status','response_url':'https://queue.fal.run/a/b/requests/abc'})
        a=submit(self.case,'hero','fal-ai/example',{'prompt':'one'},.2,True,send)
        b=submit(self.case,'hero','fal-ai/example',{'prompt':'one'},.2,True,send);self.assertEqual(a,b);self.assertEqual(send.call_count,1)
        poll=Mock(side_effect=[{'status':'COMPLETED'},{'images':[]}]);r=status(self.case,a['job_id'],poll);self.assertEqual(r['state'],'completed')
        status(self.case,a['job_id'],poll);self.assertEqual(poll.call_count,2)
    def test_ambiguous_post_never_blindly_resubmits(self):
        self.configure_fal();send=Mock(side_effect=TimeoutError())
        with self.assertRaises(ValueError):submit(self.case,'hero','fal-ai/example',{'prompt':'one'},.2,True,send)
        r=submit(self.case,'hero','fal-ai/example',{'prompt':'one'},.2,True,send)
        self.assertEqual(r['state'],'ambiguous');self.assertEqual(send.call_count,1)
    def test_budget_and_url_guards(self):
        self.configure_fal();send=Mock()
        with self.assertRaises(ValueError):submit(self.case,'hero','fal-ai/example',{},1.1,True,send)
        send.assert_not_called()
        for url in ['https://evil.test/result','https://queue.fal.run.evil.test/a','http://queue.fal.run/a']:
            with self.assertRaises(ValueError):queue_url(url)
    @unittest.skipUnless(shutil.which('ffmpeg') and shutil.which('ffprobe'),'ffmpeg optional')
    def test_video_inspection_outside_repo(self):
        path=self.root/'portrait clip.mp4'
        subprocess.run(['ffmpeg','-v','error','-f','lavfi','-i','color=c=red:s=48x80:r=12:d=1','-pix_fmt','yuv420p',str(path)],check=True)
        self.init(inputs=[str(path)]);r=inspect(self.case,3)
        self.assertEqual(r[0]['inspection'],'frames-extracted');self.assertEqual(len(r[0]['frames']),3)
        for f in r[0]['frames']:self.assertTrue((self.case/f['path']).exists())

if __name__=='__main__':unittest.main()

"""Check portable packaging, local documentation links, examples and accidental private artifacts."""
import json,os,re,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'skills/reference-to-game/scripts'))
from r2g.core import validate
errors=[];count=0
skip={'node_modules','dist','dist-playtest','.git','__pycache__','.venv','work'}
for base,dirs,names in os.walk(ROOT):
 dirs[:]=[d for d in dirs if d not in skip]
 for name in names:
  p=Path(base)/name;count+=1
  if p.stat().st_size>50_000_000:errors.append(str(p.relative_to(ROOT))+' exceeds 50 MB')
  if name=='.env' or name.startswith('.env.') and name!='.env.example':errors.append('Private environment file: '+str(p))
  if p.suffix not in ('.md','.txt','.json','.py','.js','.mjs','.ts','.html','.yml','.yaml'):continue
  text=p.read_text(errors='replace')
  if '/Users/' in text and p!=Path(__file__).resolve():errors.append('Author-machine path: '+str(p.relative_to(ROOT)))
  if re.search(r'\b(?:gh[pousr]_[A-Za-z0-9]{30,}|sk-[A-Za-z0-9]{30,})\b',text):errors.append('Possible credential: '+str(p.relative_to(ROOT)))
  if p.suffix=='.md':
   for link in re.findall(r'\]\(([^\s)]+)(?:\s+[^)]*)?\)',text):
    if ':' in link or link.startswith('#'):continue
    path=link.split('#')[0]
    if path and not (p.parent/path).exists():errors.append('Broken link '+str(p.relative_to(ROOT))+': '+link)
plugin=json.loads((ROOT/'.claude-plugin/plugin.json').read_text());market=json.loads((ROOT/'.claude-plugin/marketplace.json').read_text())
if plugin['name']!=market['plugins'][0]['name']:errors.append('Plugin name mismatch')
for case in sorted((ROOT/'examples').iterdir()):
 if case.is_dir():errors.extend(case.name+': '+e for e in validate(case))
skill=(ROOT/'skills/reference-to-game/SKILL.md').read_text()
if not skill.startswith('---\nname: reference-to-game\ndescription:'):errors.append('Invalid skill entrypoint')
if len(skill.splitlines())>200:errors.append('Skill entrypoint too large; move conditional detail to references')
print(json.dumps({'ok':not errors,'files_checked':count,'errors':errors},indent=2))
sys.exit(bool(errors))

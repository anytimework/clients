import fs from 'node:fs';

const files = ['index.html', 'portal'];

const oldSort = `    list.sort((a,b)=>{ const c=String(b.shift_date||'').localeCompare(String(a.shift_date||'')); return c!==0?c:this.fmtTime(a.scheduled_start).localeCompare(this.fmtTime(b.scheduled_start)); });
    if(f==='upcoming'||f==='available') list.reverse();`;

const newSort = `    list.sort((a,b)=>{
      const ad=String(a.shift_date||''), bd=String(b.shift_date||'');
      const af=ad>=today, bf=bd>=today;
      if(af!==bf) return af?-1:1;
      const c=af?ad.localeCompare(bd):bd.localeCompare(ad);
      return c!==0?c:this.fmtTime(a.scheduled_start).localeCompare(this.fmtTime(b.scheduled_start));
    });`;

for (const file of files) {
  const raw = fs.readFileSync(file, 'utf8');
  const pattern = /(<script type="__bundler\/template">\s*)([\s\S]*?)(\s*<\/script>)/;
  const match = raw.match(pattern);
  if (!match) throw new Error(`${file}: bundled template not found`);

  const template = JSON.parse(match[2]);
  const count = template.split(oldSort).length - 1;
  if (count !== 1) throw new Error(`${file}: expected one shift-sort block, found ${count}`);

  const patched = template.replace(oldSort, newSort);
  const encoded = JSON.stringify(patched).replaceAll('</', '<\\u002F');
  fs.writeFileSync(file, raw.replace(pattern, (_all, prefix, _old, suffix) => `${prefix}${encoded}${suffix}`));
}

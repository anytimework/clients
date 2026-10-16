import fs from 'node:fs';

const files = ['index.html', 'portal'];

const replacements = [
  [
    "    const completed=all.filter(s=>this.classify(s)==='completed');",
    "    const incurred=all.filter(s=>{ const status=this.classify(s); return status==='completed'||status==='past'; });"
  ],
  [
    '    const curCost=this.sumByCcy(completed);',
    '    const curCost=this.sumByCcy(incurred);'
  ],
  [
    "        metric('Current cost',this.fmtCcyMap(curCost,this.clientSym()),completed.length+' completed shift'+(completed.length===1?'':'s'),C.green),",
    "        metric('Current cost',this.fmtCcyMap(curCost,this.clientSym()),incurred.length+' past/completed shift'+(incurred.length===1?'':'s'),C.green),"
  ],
  [
    "    const completed=list.filter(s=>this.classify(s)==='completed');",
    "    const incurred=list.filter(s=>{ const status=this.classify(s); return status==='completed'||status==='past'; });"
  ],
  [
    '    const curMap=this.sumByCcy(completed), estMap=this.sumByCcy(pending);',
    '    const curMap=this.sumByCcy(incurred), estMap=this.sumByCcy(pending);'
  ],
  [
    "        this.bigMetric('Current cost',this.fmtCcyMap(curMap,this.clientSym()),'Billed — clocked out',C.green),",
    "        this.bigMetric('Current cost',this.fmtCcyMap(curMap,this.clientSym()),'Past & clocked-out shifts',C.green),"
  ]
];

for (const file of files) {
  const raw = fs.readFileSync(file, 'utf8');
  const pattern = /(<script type="__bundler\/template">\s*)([\s\S]*?)(\s*<\/script>)/;
  const match = raw.match(pattern);
  if (!match) throw new Error(`${file}: bundled template not found`);

  let template = JSON.parse(match[2]);
  for (const [before, after] of replacements) {
    const count = template.split(before).length - 1;
    if (count !== 1) throw new Error(`${file}: expected one match for ${before}, found ${count}`);
    template = template.replace(before, after);
  }

  const encoded = JSON.stringify(template).replaceAll('</', '<\\u002F');
  fs.writeFileSync(file, raw.replace(pattern, (_all, prefix, _old, suffix) => `${prefix}${encoded}${suffix}`));
}

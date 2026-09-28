import fs from 'node:fs';
const R = '/Users/nour/Downloads/code/aris-open';
const r = fs.readFileSync(R + '/src/renderer.js', 'utf8');

function count(needle) {
  let n = 0, i = 0;
  while ((i = r.indexOf(needle, i)) !== -1) { n++; i += needle.length; }
  return n;
}

const probes = [
  'window.aris',
  '.saveFile(',
  '.openFile(',
  '.appInfo(',
  'menu:open',
  'menu:save',
  'menu:about',
  'btn-open',
  'btn-save',
  'btn-export-aml',
  'btn-export-json',
  'btn-export-svg',
  'btn-new',
  'btn-example',
  'btn-check',
  'btn-connect',
  'btn-deleteselection',
  'btn-autolayout',
  'btn-zoom-in',
  'btn-zoom-out',
  'btn-zoom-fit',
  'btn-add-model',
  'tab-props',
  'tab-checks',
  'prop-delete',
  'edge-delete',
  'about-modal',
  'about-close',
  'about-versions',
  'about-repo',
  'file-input',
];

console.log('─ renderer.js usage audit ─');
for (const p of probes) {
  const n = count(p);
  console.log((n ? '  ' : '✗ ') + p.padEnd(22) + n + (n === 1 ? '' : (n > 1 ? ' uses' : ' MISSING?')));
}

// Check window.aris guard pattern
console.log('\nwindow.aris guard:');
const m = r.match(/window\.aris\S*/g) || [];
console.log('  distinct forms:', [...new Set(m)]);

// Check navigator/HTML file fallback (renderer must work in plain browser)
console.log('\nFile I/O paths:');
console.log('  .saveFile( uses:', count('.saveFile(') || 0);
console.log('  .openFile( uses:', count('.openFile(') || 0);
console.log('  URL.createObjectURL:', count('URL.createObjectURL'));
console.log('  a.download:', count('a.download'));
console.log('  FileReader:', count('FileReader'));
console.log('  <input type=file>:', count('file-input') + ' ref');

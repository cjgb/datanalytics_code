// Loads the browser scripts (classic <script> files that declare globals) into one
// function scope and returns the requested names. Same code as the pages run; no duplication.
const fs = require('node:fs');
const path = require('node:path');

function loadScripts(files, names) {
  const src = files.map((f) => fs.readFileSync(path.join(__dirname, '..', 'auc-exploration-tool', 'js', f), 'utf8')).join('\n;\n');
  // eslint-disable-next-line no-new-func
  return new Function(`${src}\n;return { ${names.join(', ')} };`)();
}
module.exports = { loadScripts };

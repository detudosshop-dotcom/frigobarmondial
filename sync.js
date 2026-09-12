const { execSync } = require('child_process');
const path = require('path');

const repoDir = __dirname;
const gitExe = 'C:\\Users\\paulo\\AppData\\Local\\Programs\\Git\\cmd\\git.exe';

function sync(message) {
  const commitMsg = message || process.argv.slice(2).join(' ') || ('Update ' + new Date().toISOString());
  try {
    console.log('[GIT] Sincronizando com o GitHub...');
    execSync('"' + gitExe + '" add -A', { cwd: repoDir, stdio: 'inherit' });
    try {
      execSync('"' + gitExe + '" commit -m "' + commitMsg + '"', { cwd: repoDir, stdio: 'inherit' });
    } catch (e) {
      console.log('Nenhuma alteração pendente para commit.');
    }
    execSync('"' + gitExe + '" push origin main', { cwd: repoDir, stdio: 'inherit' });
    console.log('✅ Sincronizado com sucesso no GitHub!');
  } catch (err) {
    console.error('Erro ao sincronizar:', err.message);
  }
}

sync();

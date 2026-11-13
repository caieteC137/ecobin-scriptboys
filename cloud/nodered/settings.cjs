'use strict';
for (const name of ['NODE_RED_CREDENTIAL_SECRET', 'NODE_RED_ADMIN_PASSWORD_HASH']) {
  if (!process.env[name]) throw new Error('Variavel obrigatoria ausente: ' + name);
}
module.exports = {
  uiPort: 1880,
  uiHost: '0.0.0.0',
  flowFile: 'ecobin-flows.json',
  credentialSecret: process.env.NODE_RED_CREDENTIAL_SECRET,
  adminAuth: {
    type: 'credentials',
    users: [{ username: process.env.NODE_RED_ADMIN_USER || 'admin', password: process.env.NODE_RED_ADMIN_PASSWORD_HASH, permissions: '*' }]
  },
  contextStorage: { default: { module: 'localfilesystem' } },
  logging: { console: { level: 'info', metrics: false, audit: false } },
  exportGlobalContextKeys: false,
  editorTheme: { projects: { enabled: false } }
};

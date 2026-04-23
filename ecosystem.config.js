// ecosystem.config.js
module.exports = {
  apps: [
    {
      name:        'mono-server',
      script:      'app.js',
      watch:       false,
      env: {
        NODE_ENV: 'production',
        PORT:     3000,
      },
    },
  ],
};

// pm2 process definition used by scripts/deploy/remote-deploy.sh.
// cwd is the `current` symlink, so a reload after the symlink moves runs the new release.
const appDir = process.env.APP_DIR || "/srv/bme-mis";

module.exports = {
  apps: [
    {
      name: process.env.APP_NAME || "bme-mis",
      cwd: `${appDir}/current`,
      script: "node_modules/next/dist/bin/next",
      args: `start -p ${process.env.PORT || 3000}`,
      env: { NODE_ENV: "production" },
      // One process: the nightly expiry scan runs in-process (node-cron), so a
      // cluster would send every alert once per instance.
      instances: 1,
      exec_mode: "fork",
      max_memory_restart: "1G",
    },
  ],
};
